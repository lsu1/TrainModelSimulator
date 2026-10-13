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
    expect(plan.roads).toHaveLength(1);
    expect(plan.roads[0].closed).toBe(true);
    expect(plan.roads[0].points.length).toBeGreaterThan(20);
    expect(plan.cars.length).toBeGreaterThan(0);
    expect(new Set(plan.cars.map(car => car.lane))).toEqual(new Set([-1, 1]));
    expect(plan.cars.every(car => car.roadId === plan.roads[0].id)).toBe(true);
    expect(parseScenery(plan)).toEqual(plan);
    expect(visibleScenery(plan, layout.tracks, layout.accessories)).toBe(plan);
    // Independently sample every physical rail, including inactive branches,
    // double lanes, scissors crossings and raised/graded routes.
    let closestRail = Infinity, closestRoad = Infinity, closestPair = '';
    for (const track of layout.tracks) for (const path of pathsFor(track)) {
      const count = Math.ceil(path.length / 7);
      for (let i = 0; i <= count; i++) {
        const p = path.pointAt(path.length * i / Math.max(1, count));
        for (const object of plan.objects) {
          const footprint = Math.hypot(object.width, object.depth) / 2;
          const gap = Math.hypot(p.x - object.x, p.y - object.y) - footprint;
          if (gap < closestRail) { closestRail = gap; closestPair = `${track.id}/${path.route} vs ${object.id}`; }
        }
        closestRoad = Math.min(closestRoad, distanceToRoad(p, plan.roads[0].points) - plan.roads[0].width / 2);
      }
    }
    expect(closestRail, closestPair).toBeGreaterThanOrEqual(19.9);
    expect(closestRoad).toBeGreaterThan(35);
    for (const object of plan.objects) expect(distanceToRoad(object, plan.roads[0].points) - Math.hypot(object.width, object.depth) / 2).toBeGreaterThanOrEqual(32);
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
    expect(hidden.roads).toHaveLength(0);
    expect(hidden.cars).toHaveLength(0);
    expect(visibleScenery(plan, [], [])).toBe(plan);
  });

  it('can clear a marked area and rejects invalid or missing removal locations', () => {
    const existing = make(), area = { x: 0, y: 0, radius: 240 };
    const plan = make([], [], { ...REQUEST, existing, area, prompt: 'Remove scenery here' });
    expect(plan.objects.every(object => Math.hypot(object.x, object.y) > 240)).toBe(true);
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
