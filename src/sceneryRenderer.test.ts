import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SceneryRenderer } from './sceneryRenderer';
import type { SceneryObject, SceneryPlan } from './sceneryTypes';

function plan(): SceneryPlan {
  return { version: 1, seed: 1, theme: 'city', density: 'balanced', prompt: 'City', features: ['buildings', 'roads', 'cars'],
    bounds: { minX: -100, maxX: 1200, minY: -100, maxY: 300 }, trafficPlaying: true,
    objects: [{ id: 'house', kind: 'house', x: 300, y: 180, width: 50, depth: 45, height: 32, angle: Math.PI / 2, variant: 2 }],
    roads: [{ id: 'road', points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }], width: 60, closed: false }], rivers: [],
    cars: [{ id: 'car', roadId: 'road', lane: 1, phase: .2, speed: 50, kind: 'car', variant: 1 }] };
}

describe('scenery renderer lifecycle and actual transforms', () => {
  it('reports rendered world coordinates and keeps exact car poses when only playback changes', () => {
    const world = new THREE.Group(); world.scale.setScalar(.01);
    const renderer = new SceneryRenderer(world), value = plan();
    renderer.setPlan(value);
    expect(renderer.snapshot().objects[0].position).toEqual({ x: 300, y: 180, z: 0 });
    expect(renderer.snapshot().cars[0].position.x).toBe(200);
    const meshes = [...renderer.group.children];
    renderer.update(.05);
    const moved = renderer.snapshot().cars[0];
    expect(moved.position.x).toBeCloseTo(202.5);
    expect(moved.position.y).toBeCloseTo(-15);
    expect(moved.moving).toBe(true);
    renderer.setPlan({ ...value, trafficPlaying: false });
    renderer.update(10);
    expect(renderer.group.children).toEqual(meshes);
    expect(renderer.snapshot().cars[0].position).toEqual(moved.position);
    expect(renderer.snapshot().cars[0].moving).toBe(false);
    renderer.setPlan({ ...value, trafficPlaying: true });
    renderer.update(.05);
    expect(renderer.snapshot().cars[0].position.x).toBeCloseTo(205);
    renderer.setPlan({ ...value, objects: [...value.objects, { ...value.objects[0], id: 'second-house', x: 450 }] }, true);
    expect(renderer.snapshot().cars[0].position.x).toBeCloseTo(205);
    renderer.dispose();
    expect(world.children).toEqual([]);
  });

  it('owns and disposes its resources while never adding clickable geometry', () => {
    const world = new THREE.Group(); world.scale.setScalar(.01);
    const renderer = new SceneryRenderer(world);
    renderer.setPlan({ ...plan(), style: 'urban-v2', objects: [{ ...plan().objects[0], kind: 'shop', lot: true, width: 125, depth: 100, height: 48 }],
      surfaces: [{ id: 'square', kind: 'plaza', x: 450, y: 160, width: 95, depth: 110, angle: .4, variant: 1 }] }, true);
    const geometry = new Set<THREE.BufferGeometry>(), material = new Set<THREE.Material>();
    const disposedGeometry = new Set<THREE.BufferGeometry>(), disposedMaterial = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>(), disposedTextures = new Set<THREE.Texture>();
    renderer.group.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const intersections: THREE.Intersection[] = [];
      object.raycast(new THREE.Raycaster(), intersections);
      expect(intersections).toEqual([]);
      if (!geometry.has(object.geometry)) {
        geometry.add(object.geometry);
        object.geometry.addEventListener('dispose', () => disposedGeometry.add(object.geometry));
      }
      for (const m of Array.isArray(object.material) ? object.material : [object.material]) {
        if (material.has(m)) continue;
        material.add(m); m.addEventListener('dispose', () => disposedMaterial.add(m));
        if (m instanceof THREE.MeshStandardMaterial && m.map && !textures.has(m.map)) {
          textures.add(m.map); m.map.addEventListener('dispose', () => disposedTextures.add(m.map!));
        }
      }
    });
    expect(renderer.snapshot().preview).toBe(true);
    renderer.setPlan(null);
    expect(disposedGeometry).toEqual(geometry);
    expect(disposedMaterial).toEqual(material);
    expect(textures.size).toBe(1);
    expect(disposedTextures).toEqual(textures);
    expect(renderer.group.children).toEqual([]);
    expect(renderer.snapshot().cars).toEqual([]);
    renderer.dispose();
  });

  it('keeps urban architecture, roof details, balconies and gardens inside their reserved parcels', () => {
    const kinds: SceneryObject['kind'][] = ['house', 'apartment', 'shop', 'office'];
    const renderer = new SceneryRenderer(new THREE.Group());
    for (const kind of kinds) for (const variant of [0, 7, 19]) for (const size of [[125, 100, 145], [40, 35, 20], [3, 2, .5]]) {
      const object: SceneryObject = { id: kind, kind, lot: true, x: 0, y: 0, angle: 0, width: size[0], depth: size[1], height: size[2], variant };
      renderer.setPlan({ ...plan(), style: 'urban-v2', objects: [object], roads: [], cars: [] });
      const bounds = new THREE.Box3().makeEmpty(), instance = new THREE.Matrix4();
      renderer.group.traverse(mesh => {
        if (!(mesh instanceof THREE.InstancedMesh)) return;
        mesh.geometry.computeBoundingBox();
        for (let index = 0; index < mesh.count; index++) {
          mesh.getMatrixAt(index, instance);
          bounds.union(mesh.geometry.boundingBox!.clone().applyMatrix4(instance));
        }
      });
      expect(bounds.min.x, `${kind} minimum X`).toBeGreaterThanOrEqual(-object.width / 2 - .0001);
      expect(bounds.max.x, `${kind} maximum X`).toBeLessThanOrEqual(object.width / 2 + .0001);
      expect(bounds.min.z, `${kind} minimum depth`).toBeGreaterThanOrEqual(-object.depth / 2 - .0001);
      expect(bounds.max.z, `${kind} maximum depth`).toBeLessThanOrEqual(object.depth / 2 + .0001);
      expect(bounds.max.y, `${kind} maximum height`).toBeLessThanOrEqual(object.height + .0001);
    }
    renderer.dispose();
  });

  it('renders saved surface transforms while keeping a legacy building scale unchanged in a mixed scene', () => {
    const world = new THREE.Group(); world.scale.setScalar(.01);
    const renderer = new SceneryRenderer(world), value = plan();
    renderer.setPlan(value);
    const roofMesh = () => renderer.group.children.find(mesh => mesh instanceof THREE.InstancedMesh &&
      mesh.geometry.index === null && mesh.geometry.getAttribute('position').count === 24) as THREE.InstancedMesh;
    const before = new THREE.Matrix4(); roofMesh().getMatrixAt(0, before);
    renderer.setPlan({ ...value, style: 'urban-v2', surfaces: [{ id: 'square', kind: 'parking', x: 450, y: 160, width: 95, depth: 110, angle: .4, variant: 1 }] });
    expect(renderer.snapshot().objects[0].position).toEqual({ x: 300, y: 180, z: 0 });
    expect(renderer.snapshot().surfaces[0]).toMatchObject({ id: 'square', x: 450, y: 160, z: 0, angle: .4 });
    // Additions share the box batch; the legacy roof still has its exact former scale and pose.
    const after = new THREE.Matrix4(); roofMesh().getMatrixAt(0, after);
    expect(after.elements).toEqual(before.elements);
    renderer.dispose();
  });

  it('keeps expanded park groves and playgrounds within the railway-clearance footprint', () => {
    const renderer = new SceneryRenderer(new THREE.Group());
    for (const [width, depth] of [[138, 110], [176, 144], [70, 65]]) {
      renderer.setPlan({ ...plan(), objects: [{ id: 'park', kind: 'park', x: 0, y: 0, angle: 0,
        width, depth, height: 1.5, variant: 7 }], roads: [], cars: [] });
      const bounds = new THREE.Box3().makeEmpty(), instance = new THREE.Matrix4();
      renderer.group.traverse(mesh => {
        if (!(mesh instanceof THREE.InstancedMesh)) return;
        mesh.geometry.computeBoundingBox();
        for (let index = 0; index < mesh.count; index++) {
          mesh.getMatrixAt(index, instance);
          bounds.union(mesh.geometry.boundingBox!.clone().applyMatrix4(instance));
        }
      });
      expect(bounds.min.x).toBeGreaterThanOrEqual(-width / 2 - .0001);
      expect(bounds.max.x).toBeLessThanOrEqual(width / 2 + .0001);
      expect(bounds.min.z).toBeGreaterThanOrEqual(-depth / 2 - .0001);
      expect(bounds.max.z).toBeLessThanOrEqual(depth / 2 + .0001);
    }
    renderer.dispose();
  });
});
