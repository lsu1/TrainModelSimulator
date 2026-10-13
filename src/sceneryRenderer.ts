import * as THREE from 'three';
import type { SceneryObject, SceneryPlan, SceneryPoint, SceneryRiver } from './sceneryTypes';
import { advanceTraffic, makeRoadPath, makeTrafficCars, sampleRoad, sceneryCarSize, trafficPose } from './sceneryTraffic';
import type { RoadPath, TrafficCar } from './sceneryTraffic';

type Primitive = 'box' | 'cylinder' | 'sphere' | 'cone' | 'roof' | 'hill';
interface Part { matrix: THREE.Matrix4; color: THREE.Color; car?: number }
interface Batch { primitive: Primitive; shadow: boolean; parts: Part[]; mesh?: THREE.InstancedMesh }
interface Basis { x: number; y: number; angle: number }
const NO_PICK = () => {};
const UP = new THREE.Vector3(0, 1, 0);
const PALETTES = {
  wall: [0xe5d8bd, 0xd6c5a6, 0xc2cbd0, 0xe4e3d8, 0xbbc1bf, 0xd6bcb0],
  roof: [0x4a5865, 0x754e42, 0x48585c, 0x545b59],
  car: [0xd34b42, 0xeae7d9, 0x477eaa, 0xdfb943, 0x508c7b, 0x3d4551],
  clothes: [0x315f86, 0x9c3c46, 0xe6bd57, 0x45664f, 0x6d5681, 0xe4dbca],
};
const choice = (values: number[], variant: number) => values[((variant % values.length) + values.length) % values.length];

function roofGeometry() {
  // Unit gable prism, ridge along local X, base at Y=-.5 and ridge Y=.5.
  const vertices = [
    -.5, -.5, -.5, .5, -.5, -.5, .5, .5, 0,
    -.5, -.5, -.5, .5, .5, 0, -.5, .5, 0,
    -.5, .5, 0, .5, .5, 0, .5, -.5, .5,
    -.5, .5, 0, .5, -.5, .5, -.5, -.5, .5,
    -.5, -.5, -.5, -.5, .5, 0, -.5, -.5, .5,
    .5, -.5, .5, .5, .5, 0, .5, -.5, -.5,
    -.5, -.5, .5, .5, -.5, .5, .5, -.5, -.5,
    -.5, -.5, .5, .5, -.5, -.5, -.5, -.5, -.5,
  ];
  const geometry = new THREE.BufferGeometry();
  for (let start = 0; start < vertices.length; start += 9) {
    for (let axis = 0; axis < 3; axis++) [vertices[start + 3 + axis], vertices[start + 6 + axis]] = [vertices[start + 6 + axis], vertices[start + 3 + axis]];
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** Generic miniature scenery, independent of every preset and railway model. */
export class SceneryRenderer {
  readonly group = new THREE.Group();
  private plan: SceneryPlan | null = null;
  private preview = false;
  private signature = '';
  private geometries = new Map<Primitive, THREE.BufferGeometry>();
  private materials = new Set<THREE.Material>();
  private opaque: THREE.MeshStandardMaterial | null = null;
  private staticBatches = new Map<string, Batch>();
  private carBatches = new Map<string, Batch>();
  private paths = new Map<string, RoadPath>();
  private traffic: TrafficCar[] = [];
  private carAnchors: THREE.Object3D[] = [];
  private objectAnchors: THREE.Object3D[] = [];
  private transform = new THREE.Matrix4();
  private position = new THREE.Vector3();
  private quaternion = new THREE.Quaternion();
  private scale = new THREE.Vector3();
  private carTransform = new THREE.Matrix4();

  constructor(parent: THREE.Group) {
    this.group.name = 'generated-scenery';
    this.group.userData.generatedScenery = true;
    parent.add(this.group);
  }

  setPlan(plan: SceneryPlan | null, preview = false) {
    const signature = plan ? JSON.stringify({ ...plan, trafficPlaying: undefined }) : '';
    // Pausing or resuming is an animation operation, not a city rebuild.
    if (signature === this.signature && preview === this.preview) {
      this.plan = plan;
      if (!plan?.trafficPlaying) this.traffic.forEach(car => { car.moving = false; });
      return;
    }
    const previousTraffic = new Map(this.traffic.map(entry => [entry.car.id, {
      signature: JSON.stringify([entry.car, entry.path.road]), distance: entry.distance, moving: entry.moving,
    }]));
    this.clear();
    this.plan = plan;
    this.preview = preview;
    this.signature = signature;
    if (!plan) return;
    this.opaque = new THREE.MeshStandardMaterial({
      color: preview ? 0xe1f0ec : 0xffffff, roughness: .82, metalness: .02,
    });
    this.materials.add(this.opaque);
    plan.roads.forEach(road => {
      const path = makeRoadPath(road);
      if (path.length > 0) { this.paths.set(road.id, path); this.road(path); }
    });
    plan.rivers.forEach(river => this.river(river));
    plan.objects.forEach(object => {
      const anchor = new THREE.Object3D();
      anchor.position.set(object.x, 0, object.y);
      anchor.rotation.y = -object.angle;
      this.group.add(anchor);
      this.objectAnchors.push(anchor);
      this.object(object);
    });
    this.flush(this.staticBatches, false);
    this.traffic = makeTrafficCars(plan.cars, this.paths);
    this.traffic.forEach((entry, index) => {
      const previous = previousTraffic.get(entry.car.id);
      if (previous && previous.signature === JSON.stringify([entry.car, entry.path.road])) {
        entry.distance = previous.distance;
        entry.moving = plan.trafficPlaying && previous.moving;
      }
      const anchor = new THREE.Object3D();
      this.group.add(anchor);
      this.carAnchors.push(anchor);
      this.car(entry, index);
    });
    this.flush(this.carBatches, true);
    this.updateCars();
  }

  update(deltaSeconds: number) {
    advanceTraffic(this.traffic, deltaSeconds, this.plan?.trafficPlaying ?? false);
    if (this.traffic.length && this.plan?.trafficPlaying && deltaSeconds > 0) this.updateCars();
  }

  snapshot() {
    this.group.updateWorldMatrix(true, true);
    const world = (point: THREE.Vector3) => {
      // Parent is the railway's world group, whose uniform scale is .01.
      const v = point.clone().divideScalar(.01);
      return { x: v.x, y: v.z, z: v.y };
    };
    const pointWorld = (point: SceneryPoint) => world(this.group.localToWorld(new THREE.Vector3(point.x, 0, point.y)));
    return {
      preview: this.preview,
      trafficPlaying: this.plan?.trafficPlaying ?? false,
      objects: (this.plan?.objects ?? []).map((object, index) => {
        const position = world(this.objectAnchors[index].getWorldPosition(new THREE.Vector3()));
        return { ...object, ...position, position };
      }),
      roads: (this.plan?.roads ?? []).map(road => ({ ...road, points: road.points.map(pointWorld) })),
      rivers: (this.plan?.rivers ?? []).map(river => ({ ...river, points: river.points.map(pointWorld) })),
      cars: this.traffic.map((entry, index) => {
        const position = world(this.carAnchors[index].getWorldPosition(new THREE.Vector3()));
        const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(this.carAnchors[index].getWorldQuaternion(new THREE.Quaternion()));
        return { id: entry.car.id, roadId: entry.car.roadId, lane: entry.car.lane, kind: entry.car.kind,
          ...position, position, angle: Math.atan2(forward.z, forward.x), moving: entry.moving };
      }),
      stats: { objects: this.plan?.objects.length ?? 0, roads: this.paths.size,
        rivers: this.plan?.rivers.length ?? 0, cars: this.traffic.length,
        drawCalls: this.staticBatches.size + this.carBatches.size + (this.plan?.roads.length ?? 0) * 6 + (this.plan?.rivers.length ?? 0) * 3 },
    };
  }

  dispose() {
    this.clear();
    this.group.removeFromParent();
    this.plan = null;
    this.signature = '';
  }

  private clear() {
    this.group.traverse(object => {
      if (object instanceof THREE.InstancedMesh) object.dispose();
      if (object instanceof THREE.Mesh && ![...this.geometries.values()].includes(object.geometry)) object.geometry.dispose();
    });
    this.geometries.forEach(geometry => geometry.dispose());
    this.materials.forEach(material => material.dispose());
    this.group.clear();
    this.geometries.clear();
    this.materials.clear();
    this.staticBatches.clear();
    this.carBatches.clear();
    this.paths.clear();
    this.traffic = [];
    this.carAnchors = [];
    this.objectAnchors = [];
    this.opaque = null;
  }

  private geometry(primitive: Primitive) {
    const cached = this.geometries.get(primitive);
    if (cached) return cached;
    const geometry = primitive === 'box' ? new THREE.BoxGeometry(1, 1, 1) :
      primitive === 'cylinder' ? new THREE.CylinderGeometry(1, 1, 1, 8) :
      primitive === 'cone' ? new THREE.ConeGeometry(1, 1, 8) :
      primitive === 'roof' ? roofGeometry() :
      primitive === 'hill' ? new THREE.SphereGeometry(1, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2) :
      new THREE.SphereGeometry(1, 8, 6);
    this.geometries.set(primitive, geometry);
    return geometry;
  }

  private add(primitive: Primitive, basis: Basis, x: number, z: number, y: number,
    width: number, height: number, depth: number, color: number, shadow = true, car?: number, tilt = 0) {
    const c = Math.cos(basis.angle), s = Math.sin(basis.angle);
    this.position.set(basis.x + x * c - z * s, y, basis.y + x * s + z * c);
    this.quaternion.setFromAxisAngle(UP, -basis.angle);
    if (tilt) this.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), tilt));
    this.scale.set(width, height, depth);
    this.transform.compose(this.position, this.quaternion, this.scale);
    const map = car === undefined ? this.staticBatches : this.carBatches;
    const key = `${primitive}:${shadow}`;
    let batch = map.get(key);
    if (!batch) { batch = { primitive, shadow, parts: [] }; map.set(key, batch); }
    batch.parts.push({ matrix: this.transform.clone(), color: new THREE.Color(color), car });
  }

  private flush(batches: Map<string, Batch>, dynamic: boolean) {
    batches.forEach(batch => {
      const mesh = new THREE.InstancedMesh(this.geometry(batch.primitive), this.opaque!, batch.parts.length);
      mesh.castShadow = batch.shadow;
      mesh.receiveShadow = true;
      mesh.raycast = NO_PICK;
      mesh.frustumCulled = !dynamic;
      if (dynamic) mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      batch.parts.forEach((part, index) => {
        mesh.setMatrixAt(index, part.matrix);
        mesh.setColorAt(index, part.color);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      if (!dynamic) { mesh.computeBoundingBox(); mesh.computeBoundingSphere(); }
      this.group.add(mesh);
      batch.mesh = mesh;
    });
  }

  private ribbon(points: SceneryPoint[], width: number, elevation: number, color: number, closed = false, offset = 0) {
    const path = makeRoadPath({ id: 'ribbon', points, width, closed });
    if (path.points.length < 2) return;
    const vertices: number[] = [], indices: number[] = [];
    const count = path.points.length + (closed ? 1 : 0);
    for (let index = 0; index < count; index++) {
      const point = path.points[index % path.points.length], tangent = path.tangents[index % path.points.length];
      for (const side of [-1, 1]) {
        const distance = offset + side * width / 2;
        vertices.push(point.x - tangent.y * distance, elevation, point.y + tangent.x * distance);
      }
      if (index < count - 1) {
        const base = index * 2;
        indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ color: this.preview ? new THREE.Color(color).lerp(new THREE.Color(0xb6e3d6), .12) : color,
      roughness: .9, side: THREE.DoubleSide });
    this.materials.add(material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.raycast = NO_PICK;
    this.group.add(mesh);
  }

  private road(path: RoadPath) {
    const { road } = path;
    this.ribbon(road.points, road.width + 20, -.13, 0xa6aba5, road.closed);
    this.ribbon(road.points, road.width, -.04, 0x555c60, road.closed);
    for (const side of [-1, 1]) {
      this.ribbon(road.points, 1, .04, 0xf3edda, road.closed, side * (road.width / 2 - 2));
      this.ribbon(road.points, 1.3, .10, 0xd4d1c3, road.closed, side * (road.width / 2 + .8));
    }
    for (let distance = 0; distance < path.length; distance += 26) {
      const p = sampleRoad(path, distance);
      this.add('box', p, 0, 0, .09, 13, .12, 1.1, 0xf3ead1, false);
    }
    // Small road furniture is instanced along the route, outside the carriageway.
    for (let distance = 60, index = 0; distance < path.length; distance += 180, index++) {
      const side = index % 2 ? -1 : 1;
      const p = sampleRoad(path, distance, side * (road.width / 2 + 6));
      this.add('cylinder', p, 0, 0, 19, .55, 38, .55, 0x647173);
      this.add('box', p, 0, -side * 3.5, 38, 1.1, .8, 7, 0x647173);
      this.add('box', p, 0, -side * 6, 37.5, 3.6, 1.2, 2.4, 0xe6ddac, false);
      if (index % 5 === 0) {
        const bus = sampleRoad(path, distance + 25, side * (road.width / 2 + 6));
        this.add('box', bus, 0, 0, 7, 27, 1.8, 9, 0x4f7667);
        this.add('box', bus, 0, 3 * side, 12, 27, 8, .7, 0x778c82);
        for (const x of [-11, 11]) this.add('cylinder', bus, x, 0, 10, .5, 20, .5, 0x647173);
        this.add('box', bus, 0, 0, 20, 30, 1, 12, 0x556c69);
        this.add('cylinder', bus, 18, 0, 10, .4, 20, .4, 0x667371);
        this.add('box', bus, 18, 0, 17, 3, 6, .7, 0x81ae95, false);
      }
    }
    // Four pedestrian crossings on a perimeter, fewer on a short open street.
    const crossings = road.closed ? 4 : path.length > 250 ? 2 : 1;
    for (let index = 0; index < crossings; index++) {
      const distance = path.length * (index + .35) / crossings;
      for (let stripe = -3; stripe <= 3; stripe++) {
        const p = sampleRoad(path, distance + stripe * 5);
        this.add('box', p, 0, 0, .16, 2.6, .12, road.width * .83, 0xf6f0df, false);
      }
    }
  }

  private river(river: SceneryRiver) {
    this.ribbon(river.points, river.width + 12, -.10, 0x9cac81);
    this.ribbon(river.points, river.width + 4, .02, 0xa8baac);
    this.ribbon(river.points, river.width, .08, 0x72b3c0);
    const path = makeRoadPath({ ...river, closed: false });
    for (let distance = 25; distance < path.length; distance += 65) {
      const p = sampleRoad(path, distance, Math.sin(distance) * river.width * .2);
      this.add('box', p, 0, 0, .15, 10, .08, .65, 0xa4d3d8, false);
    }
  }

  private object(object: SceneryObject) {
    if (object.kind === 'tree') { this.tree(object, 0, 0, object.width, object.height, object.variant, object.depth); return; }
    if (object.kind === 'person') { this.person(object, 0, 0, object.height, object.variant, object.width, object.depth); return; }
    if (object.kind === 'hill') {
      this.add('hill', object, 0, 0, -.18, object.width / 2, object.height, object.depth / 2,
        choice([0x829568, 0x92a477, 0x9cab82], object.variant), false);
      return;
    }
    if (object.kind === 'park') { this.park(object); return; }
    this.building(object);
  }

  private tree(basis: Basis, x: number, z: number, width: number, height: number, variant: number, depth = width) {
    const trunkHeight = height * .58;
    this.add('cylinder', basis, x, z, trunkHeight / 2, Math.max(.55, width * .035), trunkHeight, Math.max(.55, width * .035), 0x80684d);
    const green = choice([0x568653, 0x73945f, 0x47744e, 0x839d63], variant);
    if (variant % 5 === 0) {
      this.add('cone', basis, x, z, height * .6, width / 2, height * .8, depth / 2, green);
      this.add('cone', basis, x, z, height * .8, width * .36, height * .4, depth * .36, green);
    } else {
      this.add('sphere', basis, x, z, height * .70, width * .43, height * .28, depth * .4, green);
      this.add('sphere', basis, x - width * .18, z + depth * .10, height * .58, width * .3, height * .23, depth * .32, green);
      this.add('sphere', basis, x + width * .18, z - depth * .10, height * .61, width * .31, height * .25, depth * .30, green);
    }
  }

  private person(basis: Basis, x: number, z: number, height: number, variant: number, width = height * .43, depth = height * .24) {
    const h = Math.max(.1, height), body = choice(PALETTES.clothes, variant);
    const sx = Math.min(1, width / (h * .43)), sz = Math.min(1, depth / (h * .24));
    const add = (primitive: Primitive, localX: number, y: number, w: number, height: number, d: number, color: number) =>
      this.add(primitive, basis, x + localX * sx, z, y, w * sx, height, d * sz, color);
    for (const side of [-1, 1]) {
      add('box', side * h * .065, h * .22, h * .09, h * .40, h * .12, 0x354453);
      add('box', side * h * .18, h * .56, h * .07, h * .30, h * .10, body);
    }
    add('box', 0, h * .57, h * .25, h * .33, h * .18, body);
    add('sphere', 0, h * .87, h * .11, h * .12, h * .11, 0xd9b493);
    add('sphere', 0, h * .93, h * .115, h * .06, h * .11, variant % 3 ? 0x494239 : 0xd9c18a);
  }

  private building(object: SceneryObject) {
    const { width: w, depth: d, height: h, variant: v } = object;
    const house = object.kind === 'house', shop = object.kind === 'shop';
    const roofLevel = house ? h : Math.max(2, h - 6);
    const wallHeight = house ? h * .76 : roofLevel - .8;
    const wall = choice(PALETTES.wall, v);
    const windows = object.kind === 'office' ? 0x7d9caa : 0x93b1ba;
    this.add('box', object, 0, 0, .35, w + 3, .7, d + 3, 0xb9b8a9, false);
    this.add('box', object, 0, 0, wallHeight / 2 + .6, w, wallHeight, d, wall);
    this.add('box', object, 0, 0, 1.5, w + .5, 2, d + .5, 0xa6a69b, false);
    if (house) {
      this.add('roof', object, 0, 0, wallHeight + (h - wallHeight) / 2, w + 5, h - wallHeight, d + 5, choice(PALETTES.roof, v));
      // A ridge and chimney make the roof read as a miniature rather than a plain block.
      this.add('box', object, 0, 0, h - .3, w + 5, .6, 1, choice(PALETTES.roof, v), false);
      this.add('box', object, w * .25, -d * .12, h - 4, 3, 8, 3.5, 0x9d897a);
    } else {
      this.add('box', object, 0, 0, roofLevel - .6, w + 1.2, 1.4, d + 1.2, 0xa5aaa7);
      for (const z of [-1, 1]) this.add('box', object, 0, z * d / 2, roofLevel + .5, w + 1.2, 2, 1.1, 0xc5c7bc, false);
      for (const x of [-1, 1]) this.add('box', object, x * w / 2, 0, roofLevel + .5, 1.1, 2, d, 0xc5c7bc, false);
      this.add('box', object, -w * .2, -d * .15, roofLevel + 2, w * .2, 4, d * .25, 0x919da0);
      this.add('box', object, w * .24, -d * .18, roofLevel + 1.3, w * .16, 2.6, d * .2, 0xabb5b3);
      this.add('cylinder', object, -w * .2, -d * .15, roofLevel + 4.1, Math.min(w, d) * .07, .25, Math.min(w, d) * .07, 0x56676e, false);
    }
    const floors = Math.max(1, Math.min(9, Math.floor(wallHeight / 12)));
    const rows = Math.max(2, Math.min(6, Math.floor(w / 10)));
    const sideRows = Math.max(2, Math.min(5, Math.floor(d / 11)));
    const floorHeight = wallHeight / floors;
    for (let floor = 0; floor < floors; floor++) {
      const y = (floor + .55) * floorHeight + .7;
      const paneHeight = Math.min(6, floorHeight * .53);
      for (const side of [-1, 1]) {
        for (let column = 0; column < rows; column++) {
          const x = (column + .5) * w / rows - w / 2;
          if (floor === 0 && side === 1 && (shop || Math.abs(x) < w / rows * .6)) continue;
          this.add('box', object, x, side * (d / 2 + .12), y, Math.min(5, w / rows * .58), paneHeight, .25,
            (floor + column + v) % 7 === 0 ? 0xe6d9a5 : windows, false);
          if (object.kind === 'apartment' && side === 1 && floor > 0) {
            this.add('box', object, x, d / 2 + 1.5, y - paneHeight / 2, w / rows * .74, .45, 3, 0xb3b8b4, false);
            this.add('box', object, x, d / 2 + 2.8, y - paneHeight / 2 + 1.2, w / rows * .74, 2.3, .4, 0x9babae, false);
          }
        }
        for (let column = 0; column < sideRows; column++) {
          const z = (column + .5) * d / sideRows - d / 2;
          this.add('box', object, side * (w / 2 + .12), z, y, .25, paneHeight, Math.min(5, d / sideRows * .53), windows, false);
        }
      }
      if (floor && !house) this.add('box', object, 0, d / 2 + .25, floor * floorHeight + .5, w, .45, .8, 0xb4b7ad, false);
    }
    this.add('box', object, 0, d / 2 + .2, 5, Math.min(7, w * .16), 9, .4, 0x576d75, false);
    this.add('box', object, 1.8, d / 2 + .45, 5, .25, 1.8, .2, 0xd6ceb4, false);
    if (shop) {
      for (const side of [-1, 1]) {
        this.add('box', object, side * w * .29, d / 2 + .2, 5, w * .31, 7.4, .4, 0x84a6ae, false);
        this.add('box', object, side * w * .29, d / 2 + .7, 1.2, w * .32, 1.7, 1, 0x6f8b7b, false);
      }
      const awning = choice([0x669b85, 0xb6524e, 0xc19e55, 0x57818f], v);
      this.add('box', object, 0, d / 2 + 2.5, 10.1, w * .92, 1.3, 5.5, awning, false);
      for (let stripe = 0; stripe < 9; stripe++) this.add('box', object, (stripe - 4) * w * .1, d / 2 + 2.5, 10.8, w * .035, .1, 5.5, 0xe8e0c4, false);
      this.add('box', object, 0, d / 2 + .3, 13, w * .55, 3.6, .6, awning, false);
      // Sign lettering is a restrained pattern, requiring no per-shop textures.
      for (let mark = -2; mark <= 2; mark++) this.add('box', object, mark * w * .065, d / 2 + .7, 13, w * .035, 1.4, .1, 0xf4edd7, false);
    }
  }

  private park(object: SceneryObject) {
    const { width: w, depth: d, variant: v } = object;
    this.add('box', object, 0, 0, -.06, w, .24, d, 0x9db888, false);
    this.add('box', object, 0, 0, .13, w * .96, .12, 5, 0xd2c7ad, false);
    this.add('box', object, w * .12, 0, .16, 5, .12, d * .96, 0xd2c7ad, false);
    for (const side of [-1, 1]) {
      this.tree(object, side * w * .32, -d * .28, Math.min(w, d) * .25, Math.min(42, d * .48), v + side + 2);
      this.add('box', object, side * w * .23, 7, 4, 15, 1.2, 4, 0x876d4c);
      this.add('box', object, side * w * .23, 9, 6, 15, 4, .6, 0x987954);
      for (const x of [-6, 6]) this.add('box', object, side * w * .23 + x, 7, 2, .6, 4, 3, 0x626e61);
    }
    if (w > 70 && d > 65) {
      // Compact playground: sandbox, a colourful slide and swing frame.
      this.add('box', object, -w * .23, d * .25, .18, w * .3, .35, d * .28, 0xcdbb87, false);
      this.add('box', object, -w * .25, d * .25, 6, 5, 12, 5, 0xc17c4c);
      this.add('box', object, -w * .19, d * .25, 6, 14, 1, 4, 0xdbbd56, false, undefined, .64);
      const swingX = w * .30, swingZ = d * .25;
      for (const side of [-1, 1]) this.add('cylinder', object, swingX + side * 7, swingZ, 7, .5, 14, .5, 0x7796a1);
      this.add('box', object, swingX, swingZ, 14, 16, .8, .8, 0x7796a1);
      for (const side of [-1, 1]) this.add('cylinder', object, swingX + side * 2, swingZ, 9, .14, 9, .14, 0x788587, false);
      this.add('box', object, swingX, swingZ, 4.5, 5, .7, 3, 0xb77357);
    }
  }

  private car(entry: TrafficCar, index: number) {
    const basis: Basis = { x: 0, y: 0, angle: 0 };
    const size = sceneryCarSize(entry.car, entry.path.road.width);
    const { length: l, width: w, height: h } = size;
    const bus = entry.car.kind === 'bus', van = entry.car.kind === 'van';
    const body = choice(PALETTES.car, entry.car.variant);
    const add = (primitive: Primitive, x: number, z: number, y: number, width: number, height: number, depth: number,
      color: number, shadow = true, rotate = 0) => this.add(primitive, basis, x, z, y, width, height, depth, color, shadow, index, rotate);
    add('box', 0, 0, h * .35, l, h * .36, w, body);
    add('box', bus ? 0 : -l * .06, 0, h * .65, l * (bus ? .96 : van ? .73 : .60), h * .42, w * .90, body);
    add('box', 0, 0, h * .91, l * (bus ? .94 : van ? .72 : .59), .8, w * .93, bus ? 0xe9e5d6 : body);
    const panes = bus ? 7 : van ? 3 : 2;
    for (const side of [-1, 1]) {
      for (let pane = 0; pane < panes; pane++) {
        const x = (pane + .5) / panes * l * (bus ? .85 : .56) - l * (bus ? .425 : .32);
        add('box', x, side * w * .459, h * .67, l * (bus ? .77 : .46) / panes, h * .23, .2, 0x7998a5, false);
      }
      for (const axle of [-1, 1]) {
        // Wheels use spheres flattened across the axle so they remain cheap shared instances.
        add('sphere', axle * l * .30, side * w * .45, h * .22, h * .19, h * .19, .85, 0x343c3e);
        add('sphere', axle * l * .30, side * w * .50, h * .22, h * .095, h * .095, .22, 0xa7b0af, false);
      }
    }
    const nose = bus ? l * .482 : van ? l * .308 : l * .258;
    add('box', nose, 0, h * .67, .25, h * .24, w * .78, 0x86a4af, false);
    add('box', -l * (bus ? .482 : van ? .405 : .37), 0, h * .67, .25, h * .22, w * .77, 0x77939f, false);
    for (const side of [-1, 1]) {
      add('box', l / 2 + .15, side * w * .3, h * .37, .25, h * .1, w * .18, 0xf6e6bd, false);
      add('box', -l / 2 - .15, side * w * .32, h * .38, .25, h * .12, w * .15, 0xab4038, false);
    }
    add('box', l / 2 + .2, 0, h * .24, .4, .7, w * .72, 0xc7c8be, false);
    add('box', -l / 2 - .2, 0, h * .24, .4, .7, w * .72, 0xc7c8be, false);
    if (bus) {
      add('box', l * .30, -w / 2 - .16, h * .47, 5, h * .61, .28, 0x667f86, false);
      add('box', -l * .20, -w / 2 - .16, h * .47, 5, h * .61, .28, 0x667f86, false);
      add('box', 0, w / 2 + .17, h * .3, l * .92, h * .10, .3, 0xf1e7d2, false);
    }
  }

  private updateCars() {
    this.traffic.forEach((entry, index) => {
      const pose = trafficPose(entry), anchor = this.carAnchors[index];
      anchor.position.set(pose.x, .12, pose.y);
      anchor.rotation.y = -pose.angle;
      anchor.updateMatrix();
    });
    this.carBatches.forEach(batch => {
      batch.parts.forEach((part, index) => {
        this.carTransform.multiplyMatrices(this.carAnchors[part.car!].matrix, part.matrix);
        batch.mesh!.setMatrixAt(index, this.carTransform);
      });
      batch.mesh!.instanceMatrix.needsUpdate = true;
    });
  }
}
