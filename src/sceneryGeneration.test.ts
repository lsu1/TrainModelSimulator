import { describe, expect, it } from 'vitest';
import { createLayout } from './layout';
import type { LayoutPreset, PlacedAccessory } from './layout';
import { pathsFor } from './track';
import type { Track } from './track';
import { generateScenery, sceneryGeometryKey, visibleScenery } from './sceneryGeneration';
import { parseScenery } from './sceneryValidation';
import type { SceneryPlan, SceneryPoint, SceneryRequest } from './sceneryTypes';

const REQUEST: SceneryRequest = { theme: 'city', density: 'balanced', features: ['buildings', 'roads', 'cars', 'people', 'trees', 'parks', 'river'], prompt: '', seed: 72 };
const PRESETS: LayoutPreset[] = ['city', 'viaduct', 'empty', 'compact', 'kato-plan02', 'kato-plan06-15'];
function make(tracks: readonly Track[] = [], accessories: readonly PlacedAccessory[] = [], request = REQUEST): SceneryPlan {
  const result = generateScenery(tracks, accessories, request);
  expect(result.plan, result.message).not.toBeNull();
  return result.plan!;
}
function segmentDistance(p: SceneryPoint, a: SceneryPoint, b: SceneryPoint): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
function distanceToRoad(p: SceneryPoint, points: SceneryPoint[]): number {
  return Math.min(...points.map((a, i) => segmentDistance(p, a, points[(i + 1) % points.length])));
}
function distanceToLot(point: SceneryPoint, lot: SceneryPlan['objects'][number], c: number, s: number): number {
  const x = (point.x - lot.x) * c + (point.y - lot.y) * s;
  const y = -(point.x - lot.x) * s + (point.y - lot.y) * c;
  return Math.hypot(Math.max(0, Math.abs(x) - lot.width / 2), Math.max(0, Math.abs(y) - lot.depth / 2));
}
describe('generic guided scenery', () => {
  it('understands the single Chinese tree word advertised in the panel', () => {
    const plan = make([], [], { ...REQUEST, features: [], prompt: '树' });
    expect(plan.features).toEqual(['trees']);
    expect(plan.objects.length).toBeGreaterThan(0);
    expect(plan.objects.every(object => object.kind === 'tree')).toBe(true);
  });
  it.each(PRESETS)('builds a bounded connected city without changing the %s railway', preset => {
    const layout = createLayout(preset), before = JSON.stringify(layout);
    const plan = make(layout.tracks, layout.accessories);
    expect(JSON.stringify(layout)).toBe(before);
    expect(plan.objects.length).toBeGreaterThan(30);
    expect(plan.objects.length).toBeLessThanOrEqual(400);
    expect(plan.roads.length).toBeGreaterThanOrEqual(1);
    expect(plan.roads.length).toBeLessThanOrEqual(8);
    expect(plan.roads[0].closed).toBe(true);
    expect(plan.roads[0].points.length).toBeGreaterThan(20);
    expect(plan.cars.length).toBeGreaterThan(0);
    expect(new Set(plan.cars.map(car => car.lane))).toEqual(new Set([-1, 1]));
    expect(plan.cars.every(car => car.roadId === plan.roads[0].id)).toBe(true);
    expect(parseScenery(plan)).toEqual(plan);
    expect(visibleScenery(plan, layout.tracks, layout.accessories)).toBe(plan);
    // Independently sample every physical rail, including inactive branches,
    // double lanes, scissors crossings and raised/graded routes.
    const objectFootprints = plan.objects.map(object => ({ ...object, footprint: Math.hypot(object.width, object.depth) / 2 }));
    const surfaceFootprints = (plan.surfaces ?? []).map(surface => ({ ...surface, footprint: Math.hypot(surface.width, surface.depth) / 2 }));
    let closestRail = Infinity, closestRoad = Infinity, closestSurface = Infinity, closestPair = '';
    for (const track of layout.tracks) for (const path of pathsFor(track)) {
      const count = Math.ceil(path.length / 7);
      for (let i = 0; i <= count; i++) {
        const p = path.pointAt(path.length * i / Math.max(1, count));
        for (const object of objectFootprints) {
          const squaredDistance = (p.x - object.x) ** 2 + (p.y - object.y) ** 2;
          if (object.footprint + closestRail <= 0 || squaredDistance >= (object.footprint + closestRail) ** 2) continue;
          const gap = Math.sqrt(squaredDistance) - object.footprint;
          if (gap < closestRail) { closestRail = gap; closestPair = `${track.id}/${path.route} vs ${object.id}`; }
        }
        for (const road of plan.roads) closestRoad = Math.min(closestRoad, distanceToRoad(p, road.points) - road.width / 2);
        for (const surface of surfaceFootprints) {
          const squaredDistance = (p.x - surface.x) ** 2 + (p.y - surface.y) ** 2;
          if (surface.footprint + closestSurface > 0 && squaredDistance < (surface.footprint + closestSurface) ** 2) closestSurface = Math.sqrt(squaredDistance) - surface.footprint;
        }
      }
    }
    expect(closestRail, closestPair).toBeGreaterThanOrEqual(19.9);
    expect(closestRoad).toBeGreaterThan(35);
    expect(closestSurface).toBeGreaterThanOrEqual(19.9);
    const roadSamples = plan.roads.map(road => {
      const points: SceneryPoint[] = [];
      for (let segment = 0; segment < road.points.length - (road.closed ? 0 : 1); segment++) {
        const a = road.points[segment], b = road.points[(segment + 1) % road.points.length];
        const samples = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 7));
        for (let i = 0; i <= samples; i++) points.push({ x: a.x + (b.x - a.x) * i / samples, y: a.y + (b.y - a.y) * i / samples });
      }
      return { road, points };
    });
    let pavementGap = Infinity;
    for (const object of plan.objects) {
      const c = Math.cos(object.angle), s = Math.sin(object.angle);
      for (const { road, points } of roadSamples) {
        if (!object.lot) pavementGap = Math.min(pavementGap, distanceToRoad(object, road.points) - Math.hypot(object.width, object.depth) / 2 - road.width / 2 - (object.kind === 'person' ? 2 : 12));
        else for (const point of points) pavementGap = Math.min(pavementGap, distanceToLot(point, object, c, s) - road.width / 2 - 12);
      }
    }
    expect(pavementGap).toBeGreaterThanOrEqual(-.1);
  });

  it('is reproducible across saves, reordered geometry and switch/name changes', () => {
    const layout = createLayout('kato-plan02');
    const a = make(layout.tracks, layout.accessories);
    expect(make(layout.tracks, layout.accessories)).toEqual(a);
    const changedTracks = [...layout.tracks].reverse().map(track => ({ ...track, switchState: 'branch' as const, switchNumber: 99, route: 1 }));
    const changedAccessories = [...layout.accessories].reverse().map(accessory => ({ ...accessory, stationName: '小朋友的车站' }));
    expect(sceneryGeometryKey(changedTracks, changedAccessories)).toBe(sceneryGeometryKey(layout.tracks, layout.accessories));
    expect(make(changedTracks, changedAccessories)).toEqual(a);
    expect(make(layout.tracks, layout.accessories, { ...REQUEST, seed: 73 }).objects).not.toEqual(a.objects);
  });

  it('uses world geometry for a translated, rotated custom layout with no source plan', () => {
    const layout = createLayout('compact'), angle = .68, tx = 3100, ty = -7200;
    const tracks = layout.tracks.map(track => ({ ...track, x: tx + track.x * Math.cos(angle) - track.y * Math.sin(angle), y: ty + track.x * Math.sin(angle) + track.y * Math.cos(angle), angle: track.angle + angle }));
    const plan = make(tracks);
    expect(plan.bounds.minX).toBeGreaterThan(1500);
    expect(plan.bounds.maxY).toBeLessThan(-5500);
    expect(visibleScenery(plan, tracks, [])).toBe(plan);
    expect(parseScenery(plan)).toEqual(plan);
  });

  it('keeps widely separated custom ground bounded without allocating its entire planting grid', () => {
    const tracks: Track[] = [
      { id: 'far-a', kind: 's248', x: -50000, y: -50000, angle: 0, bend: 1 },
      { id: 'far-b', kind: 's248', x: 50000, y: 50000, angle: 0, bend: 1 },
    ];
    const request: SceneryRequest = { ...REQUEST, features: ['trees'], density: 'busy' };
    const plan = make(tracks, [], request);
    expect(plan.objects.length).toBeGreaterThan(0);
    expect(plan.objects.length).toBeLessThanOrEqual(400);
    expect(plan.objects.every(object => object.kind === 'tree')).toBe(true);
    expect(plan.roads).toHaveLength(0);
    expect(parseScenery(plan)).toEqual(plan);
    expect(make(tracks, [], request)).toEqual(plan);
  });

  it('keeps total street and river lengths importable across widely separated custom tracks', () => {
    const tracks: Track[] = [
      { id: 'far-a', kind: 's248', x: -50000, y: -50000, angle: 0, bend: 1 },
      { id: 'far-b', kind: 's248', x: 50000, y: 50000, angle: 0, bend: 1 },
    ];
    const plan = make(tracks, [], { ...REQUEST, features: ['roads', 'cars', 'river'] });
    expect(plan.roads.length).toBeGreaterThan(0);
    expect(plan.cars.every(car => plan.roads.some(road => road.id === car.roadId && road.closed))).toBe(true);
    expect(parseScenery(plan)).toEqual(plan);
  });

  it('interprets the approved English and Chinese ideas and gives honest unsupported feedback', () => {
    const result = generateScenery([], [], { ...REQUEST, features: [], prompt: '乡村，有房子、树木、公园、小河和道路上的汽车' });
    expect(result.plan?.theme).toBe('countryside');
    expect(result.plan?.features).toEqual(['buildings', 'roads', 'cars', 'trees', 'parks', 'river']);
    expect(result.plan?.rivers).toHaveLength(1);
    expect(result.recognized).toContain('houses');
    const tall = make([], [], { ...REQUEST, features: ['buildings'], prompt: 'Tall apartment buildings' });
    expect(tall.objects.every(object => object.kind === 'apartment' && object.height > 150)).toBe(true);
    const unsupported = generateScenery([], [], { ...REQUEST, prompt: 'A flying purple octopus playing jazz' });
    expect(unsupported.plan).toBeNull();
    expect(unsupported.message).toContain('Try city');
    expect(generateScenery([], [], { ...REQUEST, prompt: '' }).plan).not.toBeNull();
  });

  it('preserves scenery outside an area and road routes, traffic phases and pause state inside it', () => {
    const existing = make(); existing.trafficPlaying = false;
    const target = existing.objects.find(object => object.kind === 'apartment')!;
    const area = { x: target.x, y: target.y, radius: 190 };
    const outside = existing.objects.filter(object => Math.hypot(object.x - area.x, object.y - area.y) > area.radius);
    const plan = make([], [], { ...REQUEST, features: ['trees', 'parks'], prompt: 'Add a park with trees here', seed: 72, area, existing });
    for (const object of outside) expect(plan.objects.find(item => item.id === object.id)).toBe(object);
    expect(plan.roads).toBe(existing.roads);
    expect(plan.cars).toBe(existing.cars);
    expect(plan.rivers).toBe(existing.rivers);
    const outsideSurfaces = existing.surfaces?.filter(surface => Math.hypot(surface.x - area.x, surface.y - area.y) > area.radius) ?? [];
    for (const surface of outsideSurfaces) expect(plan.surfaces?.find(item => item.id === surface.id)).toBe(surface);
    expect(plan.trafficPlaying).toBe(false);
    expect(plan.objects.some(object => !outside.includes(object))).toBe(true);
    expect(parseScenery(plan)).toEqual(plan); // Same seed must not duplicate IDs.
    for (const object of plan.objects.filter(object => !outside.includes(object))) expect(Math.hypot(object.x - area.x, object.y - area.y) + Math.hypot(object.width, object.depth) / 2).toBeLessThanOrEqual(area.radius);
  });

  it('reports cramped marked areas instead of forcing buildings through railway rails', () => {
    const track: Track = { id: 'straight', kind: 's248', x: 0, y: 0, angle: 0, bend: 1 };
    const existing = make([track]);
    const result = generateScenery([track], [], { ...REQUEST, features: ['buildings'], prompt: 'tall buildings', area: { x: 124, y: 0, radius: 25 }, existing });
    expect(result.message).toContain('Buildings do not fit');
    expect(result.plan?.objects.some(object => Math.hypot(object.x - 124, object.y) < 25)).toBe(false);
  });

  it('hides railway collisions and matching traffic after edits, without altering the saved scenery', () => {
    const plan = make(), before = JSON.stringify(plan), object = plan.objects[0];
    const added: Track = { id: 'added', kind: 's248', x: object.x - 124, y: object.y, angle: 0, bend: 1 };
    const safe = visibleScenery(plan, [added], []);
    expect(safe.objects.some(item => item.id === object.id)).toBe(false);
    expect(JSON.stringify(plan)).toBe(before);
    const road = plan.roads[0], p = road.points[2];
    const crossing: Track = { id: 'crossing', kind: 's248', x: p.x - 124, y: p.y, angle: 0, bend: 1 };
    const hidden = visibleScenery(plan, [crossing], []);
    expect(hidden.roads.some(item => item.id === road.id)).toBe(false);
    expect(hidden.cars).toHaveLength(0);
    expect(visibleScenery(plan, [], [])).toBe(plan);
  });

  it('can clear a marked area and rejects invalid or missing removal locations', () => {
    const existing = make(), area = { x: 0, y: 0, radius: 240 };
    const plan = make([], [], { ...REQUEST, existing, area, prompt: 'Remove scenery here' });
    expect(plan.objects.every(object => Math.hypot(object.x, object.y) > 240)).toBe(true);
    expect(plan.surfaces?.every(surface => Math.hypot(surface.x, surface.y) > 240)).toBe(true);
    expect(generateScenery([], [], { ...REQUEST, prompt: 'Remove scenery' }).plan).toBeNull();
    expect(generateScenery([], [], { ...REQUEST, area: { x: NaN, y: 0, radius: 200 } }).plan).toBeNull();
  });

  it('includes support accessories and geometry changes in the clearance key', () => {
    const layout = createLayout('viaduct'), key = sceneryGeometryKey(layout.tracks, layout.accessories);
    expect(sceneryGeometryKey(layout.tracks.map((track, i) => i ? track : { ...track, endElevation: 80 }), layout.accessories)).not.toBe(key);
    const plan = make(layout.tracks, layout.accessories), object = plan.objects[0];
    const pier: PlacedAccessory = { id: 'new-pier', kind: 'a-pier-tapered', x: object.x, y: object.y, angle: 0, elevation: 0 };
    expect(visibleScenery(plan, layout.tracks, [...layout.accessories, pier]).objects.some(item => item.id === object.id)).toBe(false);
  });
});
