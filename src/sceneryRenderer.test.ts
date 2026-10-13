import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SceneryRenderer } from './sceneryRenderer';
import type { SceneryPlan } from './sceneryTypes';

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
    renderer.setPlan(plan(), true);
    const geometry = new Set<THREE.BufferGeometry>(), material = new Set<THREE.Material>();
    const disposedGeometry = new Set<THREE.BufferGeometry>(), disposedMaterial = new Set<THREE.Material>();
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
      }
    });
    expect(renderer.snapshot().preview).toBe(true);
    renderer.setPlan(null);
    expect(disposedGeometry).toEqual(geometry);
    expect(disposedMaterial).toEqual(material);
    expect(renderer.group.children).toEqual([]);
    expect(renderer.snapshot().cars).toEqual([]);
    renderer.dispose();
  });
});
