import { SCENERY_LIMITS } from './sceneryTypes';
import { sceneryCarSize } from './sceneryTraffic';
import type { SceneryBounds, SceneryCar, SceneryObject, SceneryPlan, SceneryPoint, SceneryRiver, SceneryRoad, ScenerySurface } from './sceneryTypes';

const THEMES = ['city', 'countryside', 'hills'] as const;
const DENSITIES = ['quiet', 'balanced', 'busy'] as const;
const FEATURES = ['buildings', 'roads', 'cars', 'people', 'trees', 'parks', 'river'] as const;
const KINDS = ['house', 'apartment', 'shop', 'office', 'tree', 'park', 'person', 'hill'] as const;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Scenery contains an invalid item.');
  return value as Record<string, unknown>;
}
function finite(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`Scenery has an invalid ${label}.`);
  return value;
}
function integer(value: unknown, min: number, max: number, label: string): number {
  const result = finite(value, min, max, label);
  if (!Number.isInteger(result)) throw new Error(`Scenery has an invalid ${label}.`);
  return result;
}
function choice<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) throw new Error(`Scenery has an unrecognized ${label}.`);
  return value as T;
}
function array(value: unknown, max: number, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`Scenery ${label} must contain at most ${max} items.`);
  return value;
}
/** Strict, bounded imports. Decorative geometry never acquires executable fields. */
export function parseScenery(value: unknown): SceneryPlan | undefined {
  if (value === undefined) return undefined;
  const source = record(value);
  if (source.version !== 1) throw new Error('This scenery version is not supported.');
  const style = source.style === undefined ? undefined : choice(source.style, ['urban-v2'], 'style');
  const theme = choice(source.theme, THEMES, 'theme');
  const density = choice(source.density, DENSITIES, 'density');
  const seed = integer(source.seed, 0, 0xffffffff, 'seed');
  if (typeof source.prompt !== 'string' || source.prompt.length > SCENERY_LIMITS.prompt) throw new Error('Scenery prompt is too long or invalid.');
  if (typeof source.trafficPlaying !== 'boolean') throw new Error('Scenery traffic setting is invalid.');
  const features = array(source.features, FEATURES.length, 'features').map(item => choice(item, FEATURES, 'feature'));
  if (new Set(features).size !== features.length) throw new Error('Scenery contains duplicate features.');
  const b = record(source.bounds);
  const coordinate = (input: unknown, name = 'coordinate') => finite(input, -SCENERY_LIMITS.coordinate, SCENERY_LIMITS.coordinate, name);
  const bounds: SceneryBounds = { minX: coordinate(b.minX), maxX: coordinate(b.maxX), minY: coordinate(b.minY), maxY: coordinate(b.maxY) };
  if (bounds.minX >= bounds.maxX || bounds.minY >= bounds.maxY) throw new Error('Scenery bounds are invalid.');
  const ids = new Set<string>();
  function id(input: unknown): string {
    if (typeof input !== 'string' || !input.trim() || input.length > 100 || ids.has(input)) throw new Error('Scenery contains an invalid or duplicate identifier.');
    ids.add(input); return input;
  }
  function point(input: unknown): SceneryPoint {
    const p = record(input), result = { x: coordinate(p.x), y: coordinate(p.y) };
    if (result.x < bounds.minX || result.x > bounds.maxX || result.y < bounds.minY || result.y > bounds.maxY) throw new Error('Scenery geometry is outside its saved bounds.');
    return result;
  }
  function points(input: unknown, minimum: number): SceneryPoint[] {
    const result = array(input, SCENERY_LIMITS.pathPoints, 'path points').map(point);
    if (result.length < minimum) throw new Error('Scenery paths need more points.');
    if (result.slice(1).some((p, i) => Math.hypot(p.x - result[i].x, p.y - result[i].y) < .5)) throw new Error('Scenery paths contain coincident points.');
    return result;
  }
  let totalPathLength = 0;
  const roadLengths = new Map<string, number>();
  function measurePath(path: SceneryPoint[], closed: boolean): number {
    let length = path.reduce((sum, p, i) => i ? sum + Math.hypot(p.x - path[i - 1].x, p.y - path[i - 1].y) : sum, 0);
    if (closed) length += Math.hypot(path[0].x - path[path.length - 1].x, path[0].y - path[path.length - 1].y);
    totalPathLength += length;
    if (totalPathLength > SCENERY_LIMITS.pathLength) throw new Error(`Scenery roads and rivers exceed the ${SCENERY_LIMITS.pathLength.toLocaleString('en-US')} mm total path length limit.`);
    return length;
  }
  const objects = array(source.objects, SCENERY_LIMITS.objects, 'objects').map((input): SceneryObject => {
    const item = record(input);
    if (item.lot !== undefined && item.lot !== true) throw new Error('Scenery has an invalid building lot setting.');
    const kind = choice(item.kind, KINDS, 'object');
    if (item.lot && !['house', 'apartment', 'shop', 'office'].includes(kind)) throw new Error('Scenery lots must contain a building.');
    return { id: id(item.id), kind, ...point(item),
      angle: finite(item.angle, -1000, 1000, 'angle'), width: finite(item.width, .5, 3000, 'width'),
      depth: finite(item.depth, .5, 3000, 'depth'), height: finite(item.height, .1, 1500, 'height'),
      variant: integer(item.variant, 0, 31, 'variant'), ...(item.lot ? { lot: true } : {}) };
  });
  const surfaces = source.surfaces === undefined ? undefined : array(source.surfaces, SCENERY_LIMITS.surfaces, 'surfaces').map((input): ScenerySurface => {
    const item = record(input);
    const surface: ScenerySurface = { id: id(item.id), kind: choice(item.kind, ['paving', 'lawn', 'garden', 'plaza', 'parking'], 'surface'),
      ...point(item), angle: finite(item.angle, -1000, 1000, 'surface angle'),
      width: finite(item.width, .5, 3000, 'surface width'), depth: finite(item.depth, .5, 3000, 'surface depth'),
      variant: integer(item.variant, 0, 31, 'surface variant') };
    const c = Math.abs(Math.cos(surface.angle)), s = Math.abs(Math.sin(surface.angle));
    const rx = (surface.width * c + surface.depth * s) / 2, ry = (surface.width * s + surface.depth * c) / 2;
    if (surface.x - rx < bounds.minX - .001 || surface.x + rx > bounds.maxX + .001 ||
        surface.y - ry < bounds.minY - .001 || surface.y + ry > bounds.maxY + .001) throw new Error('Scenery surface is outside its saved bounds.');
    return surface;
  });
  const roads = array(source.roads, SCENERY_LIMITS.roads, 'roads').map((input): SceneryRoad => {
    const item = record(input);
    if (typeof item.closed !== 'boolean') throw new Error('Scenery road has an invalid closed setting.');
    const path = points(item.points, item.closed ? 3 : 2);
    if (item.closed && Math.hypot(path[0].x - path[path.length - 1].x, path[0].y - path[path.length - 1].y) < .5) throw new Error('Closed scenery roads must omit the repeated end point.');
    const length = measurePath(path, item.closed);
    if (length < 50) throw new Error('Scenery road is too short for traffic.');
    const roadId = id(item.id); roadLengths.set(roadId, length);
    return { id: roadId, points: path, width: finite(item.width, 16, 150, 'road width'), closed: item.closed };
  });
  const rivers = array(source.rivers, SCENERY_LIMITS.rivers, 'rivers').map((input): SceneryRiver => {
    const item = record(input);
    const path = points(item.points, 2); measurePath(path, false);
    return { id: id(item.id), points: path, width: finite(item.width, 8, 300, 'river width') };
  });
  const roadMap = new Map(roads.map(road => [road.id, road]));
  const cars = array(source.cars, SCENERY_LIMITS.cars, 'cars').map((input): SceneryCar => {
    const item = record(input);
    if (typeof item.roadId !== 'string' || !roadMap.get(item.roadId)?.closed) throw new Error('Scenery traffic must refer to an existing closed road.');
    if (item.lane !== 1 && item.lane !== -1) throw new Error('Scenery car lane is invalid.');
    const phase = finite(item.phase, 0, 1, 'traffic phase');
    if (phase === 1) throw new Error('Scenery traffic phase must be less than one.');
    return { id: id(item.id), roadId: item.roadId, lane: item.lane, phase,
      speed: finite(item.speed, 1, 150, 'traffic speed'), kind: choice(item.kind, ['car', 'van', 'bus'], 'vehicle'),
      variant: integer(item.variant, 0, 31, 'variant') };
  });
  for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
    const a = cars[i], b = cars[j];
    if (a.roadId !== b.roadId || a.lane !== b.lane) continue;
    const road = roadMap.get(a.roadId)!, length = roadLengths.get(a.roadId)!;
    const phaseDistance = Math.abs(a.phase - b.phase) * length;
    const gap = Math.min(phaseDistance, length - phaseDistance);
    const minimum = (sceneryCarSize(a, road.width).length + sceneryCarSize(b, road.width).length) / 2 + 7;
    if (gap < minimum) throw new Error('Scenery vehicles overlap or are too close in the same lane. Spread their saved traffic phases apart.');
  }
  return { version: 1, ...(style ? { style } : {}), seed, theme, density, features, prompt: source.prompt, bounds, objects,
    ...(surfaces === undefined ? {} : { surfaces }), roads, rivers, cars, trafficPlaying: source.trafficPlaying };
}
