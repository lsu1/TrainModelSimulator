import * as THREE from 'three';
import type { SceneryObject, SceneryPlan, SceneryPoint, SceneryRiver, ScenerySurface } from './sceneryTypes';
import { advanceTraffic, makeRoadPath, makeTrafficCars, sampleRoad, sceneryCarSize, trafficPose } from './sceneryTraffic';
import type { RoadPath, TrafficCar } from './sceneryTraffic';

type Primitive = 'box' | 'cylinder' | 'sphere' | 'cone' | 'roof' | 'hill' | 'sign0' | 'sign1' | 'sign2' | 'sign3';
type Finish = 'matte' | 'glass' | 'foliage' | 'sign';
interface Part { matrix: THREE.Matrix4; color: THREE.Color; car?: number }
interface Batch { primitive: Primitive; shadow: boolean; finish: Finish; parts: Part[]; mesh?: THREE.InstancedMesh }
interface Basis { x: number; y: number; angle: number }
const NO_PICK = () => {};
const UP = new THREE.Vector3(0, 1, 0);
const PALETTES = {
  wall: [0xe6ddc7, 0xd4b998, 0xbcc8ce, 0xf0ede1, 0xb7beb7, 0xc89078, 0xc1b8a6, 0xd8dfdd],
  roof: [0x384959, 0x794d41, 0x3c5453, 0x5a5c59],
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
  private textures = new Set<THREE.Texture>();
  private finishes = new Map<Finish, THREE.MeshStandardMaterial>();
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
    this.finishes.set('matte', this.opaque);
    const glazing = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .28, metalness: .32 });
    const foliage = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .96 });
    this.finishes.set('glass', glazing); this.finishes.set('foliage', foliage);
    this.materials.add(glazing); this.materials.add(foliage);
    const signs = new THREE.MeshStandardMaterial({ map: this.signAtlas(), color: 0xffffff, roughness: .65,
      emissive: 0xffffff, emissiveIntensity: .08, side: THREE.DoubleSide });
    this.finishes.set('sign', signs); this.materials.add(signs);
    plan.surfaces?.forEach(surface => this.surface(surface));
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
      surfaces: (this.plan?.surfaces ?? []).map(surface => ({ ...surface, ...pointWorld(surface) })),
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
    this.textures.forEach(texture => texture.dispose());
    this.group.clear();
    this.geometries.clear();
    this.materials.clear();
    this.textures.clear();
    this.finishes.clear();
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
    const geometry = primitive.startsWith('sign') ? this.signGeometry(Number(primitive.slice(4))) :
      primitive === 'box' ? new THREE.BoxGeometry(1, 1, 1) :
      primitive === 'cylinder' ? new THREE.CylinderGeometry(1, 1, 1, 8) :
      primitive === 'cone' ? new THREE.ConeGeometry(1, 1, 8) :
      primitive === 'roof' ? roofGeometry() :
      primitive === 'hill' ? new THREE.SphereGeometry(1, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2) :
      new THREE.SphereGeometry(1, 9, 7);
    this.geometries.set(primitive, geometry);
    return geometry;
  }

  private signGeometry(row: number) {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const uv = geometry.getAttribute('uv');
    for (let index = 0; index < uv.count; index++) uv.setY(index, (3 - row + uv.getY(index)) / 4);
    return geometry;
  }

  /** One shared atlas, rather than a texture allocation for every storefront. */
  private signAtlas(): THREE.Texture {
    if (typeof document === 'undefined') {
      const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
      texture.needsUpdate = true; this.textures.add(texture); return texture;
    }
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const labels = ['CORNER CAFE', 'FRESH MARKET', 'BOOKS & GIFTS', 'CITY MART'];
      const colors = ['#794539', '#316d57', '#354c67', '#1c718f'];
      for (let row = 0; row < 4; row++) {
        ctx.fillStyle = colors[row]; ctx.fillRect(0, row * 128, 1024, 128);
        ctx.fillStyle = '#f4e6c6'; ctx.fillRect(10, row * 128 + 8, 1004, 3);
        ctx.fillRect(10, row * 128 + 117, 1004, 3);
        ctx.font = '600 68px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(labels[row], 512, row * 128 + 65);
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
    this.textures.add(texture); return texture;
  }

  private surface(surface: ScenerySurface) {
    const { width: w, depth: d, variant: v, kind } = surface;
    const base = kind === 'lawn' || kind === 'garden' ? choice([0x75935a, 0x849f66, 0x6f8955], v) :
      kind === 'parking' ? 0x727575 : kind === 'plaza' ? choice([0xd0c1a5, 0xb8b4a5, 0xc7c0af], v) : 0xb9b6a8;
    this.add('box', surface, 0, 0, -.075, w, .10, d, base, false);
    if (w < 5 || d < 5) return;
    if (kind === 'plaza' || kind === 'paving') {
      // Long joints form a readable tiled surface without hundreds of tiny meshes.
      const nx = Math.min(16, Math.floor(w / 24)), nz = Math.min(16, Math.floor(d / 24));
      for (let index = 1; index < nx; index++) this.add('box', surface, -w / 2 + index * w / nx, 0, -.015, .35, .04, d, 0xa4a397, false);
      for (let index = 1; index < nz; index++) this.add('box', surface, 0, -d / 2 + index * d / nz, -.012, w, .04, .35, 0xa4a397, false);
    } else if (kind === 'parking') {
      const bays = Math.max(1, Math.min(12, Math.floor(w / 17)));
      for (let index = 0; index <= bays; index++) this.add('box', surface, (-.46 + index * .92 / bays) * w, d * .13, -.01, Math.min(.75, w * .06), .07, d * .64, 0xe8e5cf, false);
      this.add('box', surface, 0, d * .45, -.01, w * .92, .07, Math.min(.75, d * .06), 0xe8e5cf, false);
    } else if (kind === 'garden') {
      for (let index = 0; index < 7; index++) {
        const x = Math.sin(index * 2.71 + v) * w * .32, z = Math.cos(index * 1.87 + v) * d * .32;
        this.add('sphere', surface, x, z, .05, w * .11, .1, d * .10,
          choice([0x8ea76f, 0x59764e, 0x9baf7b], index + v), false, undefined, 0, 'foliage');
      }
    }
  }

  private add(primitive: Primitive, basis: Basis, x: number, z: number, y: number,
    width: number, height: number, depth: number, color: number, shadow = true, car?: number, tilt = 0, finish: Finish = 'matte') {
    const c = Math.cos(basis.angle), s = Math.sin(basis.angle);
    this.position.set(basis.x + x * c - z * s, y, basis.y + x * s + z * c);
    this.quaternion.setFromAxisAngle(UP, -basis.angle);
    if (tilt) this.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), tilt));
    this.scale.set(width, height, depth);
    this.transform.compose(this.position, this.quaternion, this.scale);
    const map = car === undefined ? this.staticBatches : this.carBatches;
    const key = `${primitive}:${shadow}:${finish}`;
    let batch = map.get(key);
    if (!batch) { batch = { primitive, shadow, finish, parts: [] }; map.set(key, batch); }
    batch.parts.push({ matrix: this.transform.clone(), color: new THREE.Color(color), car });
  }

  private flush(batches: Map<string, Batch>, dynamic: boolean) {
    batches.forEach(batch => {
      const mesh = new THREE.InstancedMesh(this.geometry(batch.primitive), this.finishes.get(batch.finish)!, batch.parts.length);
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
    const trunkHeight = height * .64;
    this.add('cylinder', basis, x, z, trunkHeight / 2, Math.min(width * .075, Math.max(.45, width * .035)), trunkHeight,
      Math.min(depth * .075, Math.max(.45, depth * .035)), 0x6d5841);
    const green = choice([0x477436, 0x709049, 0x3d683e, 0x7c9650, 0x51723e, 0x96a662], variant);
    const leaf = (px: number, pz: number, y: number, w: number, h: number, d: number, color: number) =>
      this.add('sphere', basis, x + px * width, z + pz * depth, height * y, width * w, height * h, depth * d, color, true, undefined, 0, 'foliage');
    if (variant % 5 === 0) {
      this.add('cone', basis, x, z, height * .52, width * .47, height * .60, depth * .47, green, true, undefined, 0, 'foliage');
      this.add('cone', basis, x, z, height * .67, width * .36, height * .52, depth * .36, 0x4c713a, true, undefined, 0, 'foliage');
      this.add('cone', basis, x, z, height * .82, width * .23, height * .35, depth * .23, green, true, undefined, 0, 'foliage');
    } else {
      leaf(0, 0, .72, .32, .24, .32, green);
      leaf(-.19, .13, .58, .28, .21, .29, 0x4b743c);
      leaf(.19, -.12, .61, .28, .22, .28, green);
      leaf(-.11, -.21, .68, .30, .23, .27, 0x779346);
      leaf(.11, .20, .67, .30, .23, .28, green);
      leaf(.04, -.03, .82, .26, .17, .26, variant % 13 === 0 ? 0xc2b29a : 0x8ea457);
      leaf(-.20, .04, .76, .20, .16, .24, 0x668943);
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
    if (object.lot === true) { this.urbanBuilding(object); return; }
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

  /** A complete reserved parcel: all architecture, trees and frontage stay inside it. */
  private urbanBuilding(object: SceneryObject) {
    const { width: lotW, depth: lotD, height: h, variant: v } = object;
    if (lotW < 40 || lotD < 35 || h < 20) {
      // Imported miniature parcels still obey the same reserved footprint.
      this.add('box', object, 0, 0, -.055, lotW, .13, lotD, 0xbeb9a5, false);
      this.add('box', object, 0, -lotD * .06, h * .41, lotW * .76, h * .82, lotD * .70, choice(PALETTES.wall, v));
      this.add('box', object, 0, -lotD * .06, h * .88, lotW * .82, h * .12, lotD * .76, choice(PALETTES.roof, v));
      this.add('box', object, 0, lotD * .295, h * .40, lotW * .52, h * .28, lotD * .01, 0x536c78, false, undefined, 0, 'glass');
      return;
    }
    const house = object.kind === 'house', shop = object.kind === 'shop', office = object.kind === 'office';
    const w = lotW * (house ? .71 : .79), d = lotD * (house ? .63 : .69), z = -lotD * .08;
    const wall = choice(PALETTES.wall, v), trim = choice([0xeee7d5, 0xd1c6ac, 0xc5c8c2], v);
    const front = z + d / 2, rear = z - d / 2;
    const roofH = house ? h * .25 - .5 : 0;
    const bodyH = house ? h * .70 : h - 8;
    const base = house ? 0x849565 : 0xbcb8ab;
    this.add('box', object, 0, 0, -.055, lotW, .13, lotD, base, false);
    // The forecourt joins the road-facing façade to the edge of its parcel.
    this.add('box', object, 0, (front + lotD / 2) / 2, .10, lotW * .97, .15, lotD / 2 - front, house ? 0xcac4ad : 0xd0c8b5, false);
    this.add('box', object, 0, lotD * .47, .27, lotW, .38, lotD * .055, 0xdcd4bf, false);
    if (!house) {
      for (let x = -lotW * .40; x < lotW * .45; x += 13) this.add('box', object, x, (front + lotD / 2) / 2, .20, .32, .06, lotD / 2 - front, 0xb5b0a1, false);
    }
    const foundation = Math.min(2.4, h * .05);
    this.add('box', object, 0, z, foundation / 2, w + 2, foundation, d + 2, 0x9c9e93, false);
    this.add('box', object, 0, z, bodyH / 2 + foundation, w, bodyH, d, wall);
    // Clear changes of material distinguish brick, stucco, glazing and concrete.
    if (!house) {
      const serviceX = w * (v % 2 ? -.36 : .36);
      this.add('box', object, serviceX, front + .36, bodyH / 2 + foundation, w * .12, bodyH, .74, choice([0x807f74, 0xb38b6b, 0x657881], v));
      for (const side of [-1, 1]) this.add('box', object, side * (w / 2 - 1), z, bodyH / 2 + foundation, 1.8, bodyH, d + .8, trim, false);
    }
    const floors = Math.max(1, Math.min(16, house ? 2 : Math.floor(bodyH / 14)));
    const floorH = bodyH / floors;
    const columns = Math.max(2, Math.min(7, Math.floor(w / (office ? 12 : 15))));
    const sideColumns = Math.max(2, Math.min(6, Math.floor(d / 15)));
    const paneH = Math.min(house ? 8 : 9, floorH * .60);
    for (let floor = 0; floor < floors; floor++) {
      const y = foundation + (floor + .55) * floorH;
      const color = choice([0x536c78, 0x708791, 0x445d6e, 0x829097], floor + v);
      if (!house && floor > 0) {
        this.add('box', object, 0, z, foundation + floor * floorH, w + .85, .9, d + .85, trim, false);
      }
      for (const side of [-1, 1]) {
        const faceZ = z + side * d / 2;
        for (let col = 0; col < columns; col++) {
          const x = (col + .5) * w / columns - w / 2;
          if (side === 1 && floor === 0 && (shop || Math.abs(x) < w / columns * .55)) continue;
          const paneW = Math.min(office ? 10 : 8, w / columns * (office ? .78 : .60));
          this.add('box', object, x, faceZ + side * .27, y, paneW + 1.2, paneH + 1.2, .55, 0x596261, false);
          this.add('box', object, x, faceZ + side * .60, y, paneW, paneH, .15,
            (col + floor + v) % 11 === 0 ? 0xc7b895 : color, false, undefined, 0, 'glass');
          if (house || !office) this.add('box', object, x, faceZ + side * .73, y, .30, paneH, .08, 0xc5c7bc, false);
          if (!house && !office && side === 1 && floor > 0) {
            const balconyDepth = Math.min(lotD * .055, 6);
            const balconyW = w / columns * .86;
            const bottom = y - paneH / 2 - .5;
            this.add('box', object, x, faceZ + balconyDepth / 2, bottom, balconyW, .8, balconyDepth, 0xc9c7b8, false);
            this.add('box', object, x, faceZ + balconyDepth, bottom + 1.5, balconyW, 2.2, .48, 0x78867f, false);
            for (const dx of [-1, 1]) this.add('box', object, x + dx * balconyW * .47, faceZ + balconyDepth / 2, bottom + 1.5, .45, 2.2, balconyDepth, 0x89948c, false);
            if ((floor + col + v) % 4 === 0) this.add('box', object, x, faceZ + balconyDepth * .63, bottom + 1, balconyW * .28, 1.8, 1.4, 0x688253, false);
          }
        }
        for (let col = 0; col < sideColumns; col++) {
          const localZ = z + (col + .5) * d / sideColumns - d / 2;
          const paneD = Math.min(office ? 11 : 8, d / sideColumns * .61);
          this.add('box', object, side * (w / 2 + .25), localZ, y, .55, paneH + 1.1, paneD + 1.1, 0x606763, false);
          this.add('box', object, side * (w / 2 + .57), localZ, y, .14, paneH, paneD, color, false, undefined, 0, 'glass');
        }
      }
    }
    const doorwayW = Math.min(10, w * .16), doorwayH = Math.min(13, bodyH * .36);
    this.add('box', object, 0, front + .55, foundation + doorwayH / 2, doorwayW + 1.5, doorwayH + .8, .8, 0x665f52, false);
    this.add('box', object, 0, front + 1.05, foundation + doorwayH / 2, doorwayW, doorwayH, .15, 0x465e68, false, undefined, 0, 'glass');
    this.add('box', object, doorwayW * .26, front + 1.2, foundation + doorwayH * .52, .35, 2, .25, 0xded5ba, false);
    this.add('box', object, 0, front + 2.5, .45, doorwayW + 4, .9, 5, 0xb7b3a3, false);
    if (house) {
      const roofW = w + 6, roofD = d + 6, roofBase = bodyH + foundation;
      this.add('roof', object, 0, z, roofBase + roofH / 2, roofW, roofH, roofD, choice(PALETTES.roof, v));
      this.add('box', object, 0, z, roofBase + roofH, roofW, .65, 1.4, choice(PALETTES.roof, v), false);
      for (let line = 1; line <= 5; line++) for (const side of [-1, 1]) {
        const dz = line * roofD / 12;
        this.add('box', object, 0, z + side * dz, roofBase + roofH * (1 - 2 * dz / roofD) + .2, roofW, .28, .35, 0x63706e, false);
      }
      this.add('box', object, -w * .25, z - d * .12, roofBase + roofH * .55, 4.5, roofH * .7, 4.5, 0x9c806b);
      // Porch and garden give each small house a visibly owned frontage.
      this.add('box', object, 0, front + 3, doorwayH + foundation + 1, doorwayW + 9, 1.2, 7, choice(PALETTES.roof, v));
      for (const side of [-1, 1]) this.add('cylinder', object, side * (doorwayW / 2 + 3), front + 5, doorwayH / 2, .4, doorwayH, .4, trim);
      this.add('box', object, w * .29, front + .8, foundation + 2.6, 9, 4.5, 1.8, 0x7a8256, false);
      this.shrub(object, w * .29, front + 1.1, 9.5, 4, 2.2, v);
    } else {
      const roofLevel = h - 6;
      this.add('box', object, 0, z, roofLevel - .7, w + 1.7, 1.4, d + 1.7, 0x7e847f);
      for (const side of [-1, 1]) {
        this.add('box', object, 0, z + side * d / 2, roofLevel + .75, w + 2, 1.8, 1.1, trim, false);
        this.add('box', object, side * w / 2, z, roofLevel + .75, 1.1, 1.8, d, trim, false);
      }
      this.add('box', object, -w * .26, z - d * .16, roofLevel + 2.6, w * .22, 5, d * .24, 0xa8aeaa);
      this.add('box', object, w * .23, z - d * .20, roofLevel + 1.4, w * .20, 2.8, d * .26, 0xc0c4bb);
      for (const dx of [-1, 1]) this.add('cylinder', object, w * .23 + dx * w * .055, z - d * .20, roofLevel + 2.95, w * .037, .2, w * .037, 0x536166, false);
      this.add('box', object, w * .25, z + d * .25, roofLevel + .42, w * .20, .7, d * .22, 0x2c4c69, false, undefined, 0, 'glass');
    }
    if (shop) {
      for (const side of [-1, 1]) {
        this.add('box', object, side * w * .29, front + .75, foundation + 5.8, w * .32, 10.4, .55, 0x42535b, false);
        this.add('box', object, side * w * .29, front + 1.05, foundation + 5.8, w * .30, 9.5, .14, 0x69878e, false, undefined, 0, 'glass');
        for (const division of [-1, 1]) this.add('box', object, side * w * .29 + division * w * .07, front + 1.18, foundation + 5.8, .35, 9.5, .08, 0xc6c5b7, false);
      }
      const awning = choice([0x447e63, 0x95574e, 0xaa884a, 0x3c7590], v);
      const canopyD = Math.min(9, lotD * .08);
      this.add('box', object, 0, front + canopyD / 2, foundation + 12.4, w * .94, 1.3, canopyD, awning);
      for (let stripe = -4; stripe <= 4; stripe++) this.add('box', object, stripe * w * .10, front + canopyD / 2, foundation + 13.1, w * .04, .12, canopyD, 0xeee3c7, false);
      this.add('box', object, 0, front + .65, foundation + 16.2, w * .72, 5.2, .8, awning, false);
      this.add(`sign${v % 4}` as Primitive, object, 0, front + 1.12, foundation + 16.2, w * .70, 4.9, 1, 0xffffff, false, undefined, 0, 'sign');
      // Outdoor tables and parked bicycles/cars read at both overview and close zoom.
      for (const side of [-1, 1]) {
        const tx = side * lotW * .31, tz = lotD * .39;
        this.add('cylinder', object, tx, tz, 3.3, 3.6, .8, 3.6, 0xc4ae82);
        this.add('cylinder', object, tx, tz, 1.6, .35, 3, .35, 0x686d60);
        for (const dx of [-1, 1]) this.add('box', object, tx + dx * 5, tz, 1.8, 2.7, .65, 2.7, 0x8d7757);
      }
    }
    // A side path and planted beds stay clear of the architecture and the road.
    const sideX = lotW * .46;
    this.add('box', object, -sideX, -.05 * lotD, .10, lotW * .065, .16, lotD * .82, 0xc5bfac, false);
    for (const side of [-1, 1]) {
      this.shrub(object, side * lotW * .465, -lotD * .19, lotW * .045, 5.5, lotD * .48, v + side);
      if (house) this.tree(object, side * lotW * .34, lotD * .34, lotW * .14, Math.min(25, h * .52), v + side + 2, lotD * .15);
    }
    if (!shop) {
      const parkedX = -lotW * .26, parkedZ = lotD * .36;
      this.add('box', object, parkedX, parkedZ, .18, lotW * .27, .2, lotD * .20, 0x777c74, false);
      for (const side of [-1, 1]) this.add('box', object, parkedX + side * lotW * .13, parkedZ, .31, .6, .08, lotD * .18, 0xe1dec7, false);
      this.parkedCar(object, parkedX, parkedZ, Math.min(25, lotW * .22), Math.min(10, lotD * .13), v);
    }
    this.add('box', object, lotW * .40, lotD * .40, 2, 2.4, 4, 1.3, 0x596f62);
    this.add('box', object, lotW * .40, lotD * .40, 4.2, 3.3, 1, 2.1, 0x647966);
    // Rear utility strip avoids an empty-looking parcel behind the model.
    this.add('box', object, 0, (rear - lotD / 2) / 2, .08, w, .12, lotD / 2 + rear, 0xa6a794, false);
  }

  private shrub(basis: Basis, x: number, z: number, width: number, height: number, depth: number, variant: number) {
    this.add('box', basis, x, z, height * .42, width, height * .65, depth, choice([0x547444, 0x66854c, 0x7c9459], variant), false, undefined, 0, 'foliage');
    const count = Math.max(1, Math.min(7, Math.floor(depth / 7)));
    for (let index = 0; index < count; index++) this.add('sphere', basis, x, z + (index + .5) * depth / count - depth / 2,
      height * .65, width * .49, height * .35, depth / count * .49, choice([0x698c4b, 0x8ca261, 0x53763e], index + variant), false, undefined, 0, 'foliage');
  }

  private parkedCar(basis: Basis, x: number, z: number, length: number, width: number, variant: number) {
    const body = choice(PALETTES.car, variant), h = width * .56;
    this.add('box', basis, x, z, h * .38, length, h * .48, width, body);
    this.add('box', basis, x - length * .05, z, h * .73, length * .61, h * .38, width * .88, body);
    for (const side of [-1, 1]) {
      this.add('box', basis, x - length * .05, z + side * width * .447, h * .74, length * .48, h * .25, .15, 0x506979, false, undefined, 0, 'glass');
      for (const axle of [-1, 1]) this.add('sphere', basis, x + axle * length * .30, z + side * width * .44, h * .22, h * .20, h * .20, .7, 0x343a3a);
    }
    this.add('box', basis, x + length * .263, z, h * .74, .2, h * .24, width * .78, 0x65828e, false, undefined, 0, 'glass');
  }

  private park(object: SceneryObject) {
    const { width: w, depth: d, variant: v } = object;
    this.add('box', object, 0, 0, -.06, w, .24, d, 0x849b61, false);
    this.add('box', object, 0, -d * .24, .065, w * .91, .025, d * .34, 0x90a86e, false);
    this.add('box', object, 0, 0, .13, w * .96, .12, 5, 0xd2c7ad, false);
    this.add('box', object, w * .12, 0, .16, 5, .12, d * .96, 0xd2c7ad, false);
    for (const side of [-1, 1]) {
      this.tree(object, side * w * .32, -d * .28, Math.min(45, w * .31, d * .36), Math.min(50, d * .52), v + side + 2);
      if (w > 100 && d > 95) {
        // Front-corner trunks sit outside the sandbox and swing; foliage shades their edges.
        this.tree(object, side * w * .39, d * .365, Math.min(43, w * .22, d * .27), Math.min(46, d * .47), v + side + 5);
      }
      this.add('box', object, side * w * .23, 7, 4, 15, 1.2, 4, 0x876d4c);
      this.add('box', object, side * w * .23, 9, 6, 15, 4, .6, 0x987954);
      for (const x of [-6, 6]) this.add('box', object, side * w * .23 + x, 7, 2, .6, 4, 3, 0x626e61);
    }
    if (w > 70 && d > 65) {
      for (const side of [-1, 1]) {
        this.shrub(object, side * w * .46, -d * .20, w * .055, 4.5, d * .48, v + side);
        this.add('box', object, side * w * .31, d * .46, .28, w * .22, .48, d * .06, 0x777d63, false);
        for (let bloom = 0; bloom < 5; bloom++) this.add('sphere', object, side * w * .31 + (bloom - 2) * w * .037, d * .46, 1.3,
          w * .018, 1, d * .021, choice([0xcfb366, 0xbbb198, 0x97656e, 0xd7c68c], bloom + v), false);
      }
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
