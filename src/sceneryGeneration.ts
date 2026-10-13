import { KATO_CATALOG } from './catalog';
import type { PlacedAccessory } from './layout';
import { pathsFor } from './track';
import type { Track } from './track';
import { SCENERY_LIMITS } from './sceneryTypes';
import type { SceneryBounds, SceneryFeature, SceneryObject, SceneryPlan, SceneryPoint, SceneryRequest, SceneryResult, SceneryRoad } from './sceneryTypes';

const CATALOG = new Map(KATO_CATALOG.map(item => [item.kind, item]));
const FEATURES: readonly SceneryFeature[] = ['buildings', 'roads', 'cars', 'people', 'trees', 'parks', 'river'];
const SAMPLE = 12;
interface Disc extends SceneryPoint { radius: number }
/** Spatial bins keep the large, many-route railway inexpensive to query. */
class Footprints {
  private bins = new Map<string, Disc[]>();
  private cell = 128;
  add(disc: Disc): void {
    const c = this.cell;
    for (let x = Math.floor((disc.x - disc.radius) / c); x <= Math.floor((disc.x + disc.radius) / c); x++) {
      for (let y = Math.floor((disc.y - disc.radius) / c); y <= Math.floor((disc.y + disc.radius) / c); y++) {
        const key = `${x}:${y}`, bucket = this.bins.get(key) ?? [];
        bucket.push(disc); this.bins.set(key, bucket);
      }
    }
  }
  clear(point: SceneryPoint, radius: number): boolean {
    const c = this.cell;
    for (let x = Math.floor((point.x - radius) / c); x <= Math.floor((point.x + radius) / c); x++) {
      for (let y = Math.floor((point.y - radius) / c); y <= Math.floor((point.y + radius) / c); y++) {
        for (const disc of this.bins.get(`${x}:${y}`) ?? []) {
          if ((point.x - disc.x) ** 2 + (point.y - disc.y) ** 2 < (radius + disc.radius) ** 2) return false;
        }
      }
    }
    return true;
  }
}
function radius(object: SceneryObject): number { return Math.hypot(object.width, object.depth) / 2; }
function sampleLine(a: SceneryPoint, b: SceneryPoint, visit: (point: SceneryPoint) => void): void {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / SAMPLE));
  for (let i = 0; i <= steps; i++) visit({ x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps });
}
function samplePath(points: readonly SceneryPoint[], closed: boolean, visit: (point: SceneryPoint) => void): void {
  for (let i = 1; i < points.length; i++) sampleLine(points[i - 1], points[i], visit);
  if (closed && points.length > 2) sampleLine(points[points.length - 1], points[0], visit);
}
function pathFootprint(points: readonly SceneryPoint[], width: number, closed: boolean, index: Footprints, margin = 0): void {
  samplePath(points, closed, point => index.add({ ...point, radius: width / 2 + SAMPLE / 2 + margin }));
}
function safePath(points: readonly SceneryPoint[], width: number, closed: boolean, index: Footprints, margin = 0): boolean {
  let clear = true;
  samplePath(points, closed, point => { if (clear && !index.clear(point, width / 2 + SAMPLE / 2 + margin)) clear = false; });
  return clear;
}
function geometry(tracks: readonly Track[], accessories: readonly PlacedAccessory[]): { obstacles: Footprints; bounds: SceneryBounds } {
  const obstacles = new Footprints();
  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  const include = (point: SceneryPoint, r = 0) => {
    bounds.minX = Math.min(bounds.minX, point.x - r); bounds.maxX = Math.max(bounds.maxX, point.x + r);
    bounds.minY = Math.min(bounds.minY, point.y - r); bounds.maxY = Math.max(bounds.maxY, point.y + r);
  };
  for (const track of tracks) for (const path of pathsFor(track)) {
    const steps = Math.max(1, Math.ceil(path.length / SAMPLE));
    for (let i = 0; i <= steps; i++) {
      const p = path.pointAt(path.length * i / steps);
      // Protect every route even when its turnout is presently straight, and
      // the ground beneath graded/elevated track rather than guessing headroom.
      obstacles.add({ x: p.x, y: p.y, radius: 26 }); include(p, 20);
    }
  }
  for (const accessory of accessories) {
    const size = CATALOG.get(accessory.kind)?.footprint;
    const r = size ? Math.hypot(size.length, size.width) / 2 + 8 : 35;
    obstacles.add({ x: accessory.x, y: accessory.y, radius: r }); include(accessory, r);
  }
  if (!Number.isFinite(bounds.minX)) Object.assign(bounds, { minX: -360, maxX: 360, minY: -240, maxY: 240 });
  // A single straight or very sparse drawing still deserves a useful setting.
  const x = (bounds.minX + bounds.maxX) / 2, y = (bounds.minY + bounds.maxY) / 2;
  if (bounds.maxX - bounds.minX < 550) { bounds.minX = x - 275; bounds.maxX = x + 275; }
  if (bounds.maxY - bounds.minY < 380) { bounds.minY = y - 190; bounds.maxY = y + 190; }
  return { obstacles, bounds };
}
/** Metadata changes do not invalidate scenery previews or stop road traffic. */
export function sceneryGeometryKey(tracks: readonly Track[], accessories: readonly PlacedAccessory[]): string {
  const pieces = tracks.map(t => [t.kind, t.x, t.y, t.angle, t.bend, t.elevation ?? 0, t.endElevation ?? t.elevation ?? 0].join(',')).sort();
  const extras = accessories.map(a => [a.kind, a.x, a.y, a.angle, a.elevation].join(',')).sort();
  return `${pieces.join(';')}|${extras.join(';')}`;
}
function expand(bounds: SceneryBounds, margin: number): SceneryBounds {
  return { minX: bounds.minX - margin, maxX: bounds.maxX + margin, minY: bounds.minY - margin, maxY: bounds.maxY + margin };
}
function inside(point: SceneryPoint, bounds: SceneryBounds, r = 0): boolean {
  return point.x - r >= bounds.minX && point.x + r <= bounds.maxX && point.y - r >= bounds.minY && point.y + r <= bounds.maxY;
}
function roundRoad(bounds: SceneryBounds, id: string): SceneryRoad {
  const r = Math.min(110, (bounds.maxX - bounds.minX) / 4, (bounds.maxY - bounds.minY) / 4);
  const points: SceneryPoint[] = [];
  const corners = [
    [bounds.maxX - r, bounds.minY + r, -Math.PI / 2],
    [bounds.maxX - r, bounds.maxY - r, 0],
    [bounds.minX + r, bounds.maxY - r, Math.PI / 2],
    [bounds.minX + r, bounds.minY + r, Math.PI],
  ];
  for (const [x, y, angle] of corners) for (let step = 0; step <= 8; step++) {
    const a = angle + step * Math.PI / 16;
    points.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r });
  }
  return { id, points, width: 60, closed: true };
}
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state += 0x6D2B79F5; let t = Math.imul(state ^ state >>> 15, 1 | state); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
interface Interpretation {
  features: SceneryFeature[]; mentionedFeatures: SceneryFeature[]; recognized: string[]; kinds: SceneryObject['kind'][];
  theme: SceneryPlan['theme']; density: SceneryPlan['density']; small: boolean; tall: boolean; remove: boolean;
}
function interpret(request: SceneryRequest): Interpretation {
  const prompt = request.prompt.toLowerCase();
  const recognized: string[] = [], features = new Set(request.features.filter(f => FEATURES.includes(f)));
  const mentioned = new Set<SceneryFeature>();
  const kinds: SceneryObject['kind'][] = [];
  const match = (pattern: RegExp, label: string, feature?: SceneryFeature, kind?: SceneryObject['kind']) => {
    if (!pattern.test(prompt)) return false;
    recognized.push(label); if (feature) { features.add(feature); mentioned.add(feature); } if (kind) kinds.push(kind); return true;
  };
  let theme = request.theme, density = request.density;
  if (match(/\bcit(?:y|ies)\b|\btown\b|\burban\b|城市|都市|城镇/, 'city')) theme = 'city';
  if (match(/\bcountryside\b|\brural\b|\bvillage\b|乡村|田园|农村|村庄/, 'countryside')) theme = 'countryside';
  if (match(/\bhills?\b|\bmountains?\b|山丘|山区|山脉|大山/, 'hills')) theme = 'hills';
  match(/\bbuildings?\b|建筑|楼房/, 'buildings', 'buildings');
  match(/\bhouses?\b|\bhomes?\b|\bcottages?\b|房子|住宅|小屋/, 'houses', 'buildings', 'house');
  match(/\bvillages?\b|村庄|村落/, 'village homes', 'buildings', 'house');
  match(/\bapartments?\b|\bflats?\b|\btowers?\b|\bskyscrapers?\b|公寓|高楼|摩天楼/, 'apartments', 'buildings', 'apartment');
  match(/\bshops?\b|\bstores?\b|商店|店铺|商铺/, 'shops', 'buildings', 'shop');
  match(/\boffices?\b|\bschools?\b|学校|办公/, 'civic buildings', 'buildings', 'office');
  match(/\broads?\b|\bstreets?\b|\btraffic\b|道路|公路|街道|马路/, 'roads', 'roads');
  match(/\bcars?\b|\bvehicles?\b|\bbus(?:es)?\b|汽车|车辆|公交/, 'cars', 'cars');
  match(/\bpeople\b|\bpedestrians?\b|\bpersons?\b|行人|人群|路人/, 'people', 'people');
  match(/\btrees?\b|\bforest\b|树林|树木|森林|种树|树/, 'trees', 'trees');
  match(/\bparks?\b|\bplaygrounds?\b|\bgardens?\b|公园|游乐场|花园/, 'parks', 'parks');
  match(/\brivers?\b|\bstreams?\b|河流|小河|河道/, 'river', 'river');
  const small = match(/\bsmall(?:er)?\b|\blower\b|矮一点|小一点|小型|变小/, 'smaller scenery');
  const tall = match(/\btall(?:er)?\b|\bhigh\b|高一点|高层|变高/, 'taller buildings');
  if (match(/\bfewer\b|\bless\b|\bquiet\b|少一点|减少|安静/, 'fewer objects')) density = 'quiet';
  if (match(/\bmore\b|\bbusy\b|\bcrowded\b|多一点|增加|热闹/, 'more objects')) density = 'busy';
  const remove = match(/\bremove\b|\bclear\b|\bdelete\b|删除|清除|移除/, 'remove in marked area');
  // Cars always have a connected road; never pretend to animate them on grass.
  if (features.has('cars')) features.add('roads');
  return { features: FEATURES.filter(f => features.has(f)), mentionedFeatures: FEATURES.filter(f => mentioned.has(f)), recognized, kinds, theme, density, small, tall, remove };
}
function makeObject(kind: SceneryObject['kind'], x: number, y: number, id: string, rng: () => number, small: boolean, tall: boolean): SceneryObject {
  const variant = Math.floor(rng() * 8), size = .85 + rng() * .3;
  const base: Record<SceneryObject['kind'], [number, number, number]> = {
    house: [48, 40, 34], apartment: [65, 48, tall ? 185 : 110], shop: [52, 36, 28], office: [78, 54, tall ? 200 : 85],
    tree: [18, 18, 34], park: [105, 85, 1.5], person: [3, 3, 11.5], hill: [190, 165, 75],
  };
  const dims = base[kind], factor = small && !['person', 'tree', 'park'].includes(kind) ? .7 : 1;
  return { id, kind, x, y, angle: Math.floor(rng() * 4) * Math.PI / 2,
    width: dims[0] * size * factor, depth: dims[1] * size * factor, height: dims[2] * size * factor, variant };
}
function distanceToPath(point: SceneryPoint, road: SceneryRoad): number {
  let best = Infinity;
  for (let i = 0; i < road.points.length; i++) {
    const a = road.points[i], b = road.points[(i + 1) % road.points.length];
    if (!road.closed && i === road.points.length - 1) break;
    const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    const t = length ? Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0;
    best = Math.min(best, Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy));
  }
  return best;
}
/** Recheck decorations after railway edits, preserving saved routes and phases. */
export function visibleScenery(plan: SceneryPlan, tracks: readonly Track[], accessories: readonly PlacedAccessory[]): SceneryPlan {
  const { obstacles } = geometry(tracks, accessories);
  const roads = plan.roads.filter(road => safePath(road.points, road.width, road.closed, obstacles, 12));
  const roadSpace = new Footprints();
  for (const road of roads) pathFootprint(road.points, road.width, road.closed, roadSpace, 12);
  const rivers = plan.rivers.filter(river => safePath(river.points, river.width, false, obstacles, 8) && safePath(river.points, river.width, false, roadSpace, 8));
  const water = new Footprints();
  for (const river of rivers) pathFootprint(river.points, river.width, false, water, 8);
  const objects = plan.objects.filter(object => {
    const r = radius(object);
    return obstacles.clear(object, r) && water.clear(object, r) && roads.every(road => distanceToPath(object, road) >= road.width / 2 + r + (object.kind === 'person' ? 2 : 12));
  });
  const roadIds = new Set(roads.map(road => road.id));
  const cars = plan.cars.filter(car => roadIds.has(car.roadId));
  if (roads.length === plan.roads.length && rivers.length === plan.rivers.length && objects.length === plan.objects.length && cars.length === plan.cars.length) return plan;
  return { ...plan, roads, rivers, objects, cars };
}
/** Browser-only guided language generation, independent of any preset identity. */
export function generateScenery(tracks: readonly Track[], accessories: readonly PlacedAccessory[], request: SceneryRequest): SceneryResult {
  const interpreted = interpret(request), prompt = request.prompt.trim();
  if (prompt && !interpreted.recognized.length) return { plan: null, recognized: [], message: 'Try city, countryside, hills, houses, shops, roads, cars, people, trees, parks or a river. You can also ask for smaller, taller or fewer buildings, or use the picture choices.' };
  const area = request.area;
  if (area && (!Number.isFinite(area.x) || !Number.isFinite(area.y) || !Number.isFinite(area.radius) || area.radius < 20 || area.radius > 2000)) return { plan: null, recognized: interpreted.recognized, message: 'Mark a ground area between 20 and 2,000 mm wide in radius, then try again.' };
  if (interpreted.remove && !area) return { plan: null, recognized: interpreted.recognized, message: 'Mark an area first to remove scenery there. The railway will stay in place.' };
  const seed = request.seed >>> 0, rng = random(seed), { obstacles, bounds: railBounds } = geometry(tracks, accessories);
  const local = !!area;
  const previous = local && request.existing ? visibleScenery(request.existing, tracks, accessories) : undefined;
  const sceneBounds = previous?.bounds ?? expand(railBounds, 460);
  if (Math.max(Math.abs(sceneBounds.minX), Math.abs(sceneBounds.maxX), Math.abs(sceneBounds.minY), Math.abs(sceneBounds.maxY)) > SCENERY_LIMITS.coordinate) return { plan: null, recognized: interpreted.recognized, message: 'This railway is too close to the scenery coordinate boundary. Move the railway nearer the centre before building surroundings.' };
  const plan: SceneryPlan = {
    version: 1, seed, theme: previous?.theme ?? interpreted.theme, density: interpreted.density,
    features: previous ? [...new Set([...previous.features, ...interpreted.features])] : interpreted.features,
    prompt: prompt.slice(0, SCENERY_LIMITS.prompt), bounds: { ...sceneBounds }, objects: [],
    roads: previous?.roads ?? [], rivers: previous?.rivers ?? [], cars: previous?.cars ?? [],
    trafficPlaying: previous?.trafficPlaying ?? true,
  };
  const notes: string[] = [];
  // An explicit local request such as "a playground here" does not inherit the
  // global City's Buildings checkbox and replace the playground with towers.
  const features = new Set(local && interpreted.mentionedFeatures.length ? interpreted.mentionedFeatures : interpreted.features);
  if (local) {
    // A marked circle selects centres, but new footprints must fit wholly inside.
    // Untouched saved objects retain identity, dimensions and style.
    plan.objects = (previous?.objects ?? []).filter(object => Math.hypot(object.x - area!.x, object.y - area!.y) > area!.radius);
    if (features.has('roads') || features.has('cars') || features.has('river')) notes.push(previous ? 'Existing roads, river routes and traffic are kept; area changes place scenery beside them.' : 'Build the whole surroundings first to add a connected road, moving traffic or river.');
  } else {
    if (features.has('roads')) {
      const road = roundRoad(expand(railBounds, 135), `scenery-road-${seed}`);
      if (safePath(road.points, road.width, true, obstacles, 12)) plan.roads.push(road);
      else notes.push('There was not enough room for a safe connected road.');
    }
    if (features.has('river')) {
      // A river follows the outer setting, without silently cutting railway rails
      // or requiring a new bridge/support to be inserted into the user's layout.
      const y = railBounds.minY - 320, points = Array.from({ length: 17 }, (_, i) => ({
        x: sceneBounds.minX + 65 + (sceneBounds.maxX - sceneBounds.minX - 130) * i / 16,
        y: y + Math.sin(i / 16 * Math.PI * 2) * 20,
      }));
      const roadSpace = new Footprints();
      for (const road of plan.roads) pathFootprint(road.points, road.width, road.closed, roadSpace, 12);
      if (safePath(points, 58, false, obstacles, 8) && safePath(points, 58, false, roadSpace, 8)) plan.rivers.push({ id: `scenery-river-${seed}`, points, width: 58 });
      else notes.push('The river could not fit without crossing the railway or road.');
    }
    if (features.has('cars') && plan.roads.length) {
      const road = plan.roads[0], count = interpreted.density === 'busy' ? 24 : interpreted.density === 'quiet' ? 8 : 14;
      for (let i = 0; i < count; i++) plan.cars.push({ id: `scenery-car-${seed}-${i}`, roadId: road.id,
        lane: i % 2 ? -1 : 1, phase: (Math.floor(i / 2) + (i % 2 ? .45 : 0)) / Math.ceil(count / 2),
        speed: 28, kind: i % 9 === 0 ? 'bus' : i % 5 === 0 ? 'van' : 'car', variant: Math.floor(rng() * 8) });
    }
  }
  const used = new Footprints(), water = new Footprints();
  const usedIds = new Set([...plan.objects, ...plan.roads, ...plan.rivers, ...plan.cars].map(item => item.id));
  for (const object of plan.objects) used.add({ ...object, radius: radius(object) + 4 });
  for (const river of plan.rivers) pathFootprint(river.points, river.width, false, water, 10);
  let serial = 0;
  const accepted: Record<string, number> = {};
  function place(object: SceneryObject): boolean {
    const r = radius(object);
    if (plan.objects.length >= SCENERY_LIMITS.objects || !inside(object, sceneBounds, r)) return false;
    if (area && Math.hypot(object.x - area.x, object.y - area.y) + r > area.radius) return false;
    if (!obstacles.clear(object, r) || !used.clear(object, r + 4) || !water.clear(object, r)) return false;
    if (plan.roads.some(road => distanceToPath(object, road) < road.width / 2 + r + (object.kind === 'person' ? 2 : 12))) return false;
    plan.objects.push(object); used.add({ ...object, radius: r + 4 }); accepted[object.kind] = (accepted[object.kind] ?? 0) + 1;
    return true;
  }
  const areaBounds = area ? { minX: Math.max(sceneBounds.minX, area.x - area.radius), maxX: Math.min(sceneBounds.maxX, area.x + area.radius), minY: Math.max(sceneBounds.minY, area.y - area.radius), maxY: Math.min(sceneBounds.maxY, area.y + area.radius) } : sceneBounds;
  function candidate(kind: SceneryObject['kind'], x?: number, y?: number): SceneryObject {
    let id: string;
    do { id = `scenery-${seed}-${serial++}`; } while (usedIds.has(id));
    usedIds.add(id);
    return makeObject(kind, x ?? areaBounds.minX + rng() * (areaBounds.maxX - areaBounds.minX), y ?? areaBounds.minY + rng() * (areaBounds.maxY - areaBounds.minY), id, rng, interpreted.small, interpreted.tall);
  }
  if (!interpreted.remove) {
    const density = interpreted.density === 'busy' ? 1.4 : interpreted.density === 'quiet' ? .55 : 1;
    const localFactor = area ? Math.min(1, Math.PI * area.radius ** 2 / 350000) : 1;
    const targetBuildings = features.has('buildings') ? Math.max(1, Math.round((interpreted.theme === 'city' ? 75 : 24) * density * localFactor)) : 0;
    const targetTrees = features.has('trees') ? Math.max(1, Math.round((interpreted.theme === 'city' ? 50 : 100) * density * localFactor)) : 0;
    const targetPeople = features.has('people') ? Math.max(1, Math.round(28 * density * localFactor)) : 0;
    const targetParks = features.has('parks') ? Math.max(1, Math.round(6 * density * localFactor)) : 0;
    const targetHills = interpreted.theme === 'hills' ? Math.max(1, Math.round(9 * density * localFactor)) : 0;
    const buildingKinds: SceneryObject['kind'][] = interpreted.kinds.length ? interpreted.kinds : interpreted.theme === 'city' ? ['house', 'apartment', 'shop', 'office', 'house', 'shop'] : ['house', 'house', 'shop'];
    const fill = (count: number, pick: () => SceneryObject['kind'], preferred?: (i: number) => SceneryPoint) => {
      let added = 0;
      for (let attempt = 0; attempt < count * 45 && added < count; attempt++) {
        const point = preferred?.(attempt), object = candidate(pick(), point?.x, point?.y);
        if (place(object)) added++;
      }
      return added;
    };
    fill(targetParks, () => 'park');
    fill(targetHills, () => 'hill');
    const buildings = fill(targetBuildings, () => buildingKinds[Math.floor(rng() * buildingKinds.length)]);
    // Small people benefit from visible pavements rather than arbitrary lawns.
    const people = fill(targetPeople, () => 'person', !area && plan.roads.length ? i => {
      const road = plan.roads[0], p = road.points[i % road.points.length], next = road.points[(i + 1) % road.points.length];
      const dx = next.x - p.x, dy = next.y - p.y, length = Math.hypot(dx, dy) || 1, side = i % 2 ? 1 : -1, t = rng();
      return { x: p.x + dx * t - dy / length * (road.width / 2 + 8) * side, y: p.y + dy * t + dx / length * (road.width / 2 + 8) * side };
    } : undefined);
    fill(targetTrees, () => 'tree');
    if (targetBuildings && !buildings) notes.push('Buildings do not fit in this area; try a larger area or smaller buildings.');
    else if (targetBuildings && buildings < targetBuildings / 2) notes.push('Only a few buildings fit while keeping the railway clear.');
    if (targetPeople && !people) notes.push('There was no clear space for people in this area.');
  }
  const changed = local ? plan.objects.filter(object => !(previous?.objects ?? []).includes(object)).length : plan.objects.length;
  if (!changed && !interpreted.remove && !notes.some(note => note.includes('do not fit'))) notes.push('No new scenery fits here. Try a larger marked area away from tracks and roads.');
  const initial = interpreted.remove ? 'Scenery in the marked area is cleared.' : `${local ? 'Area preview' : 'Surroundings preview'}: ${changed} scenery objects${local ? '' : `, ${plan.roads.length} road loop${plan.roads.length === 1 ? '' : 's'} and ${plan.cars.length} moving vehicles`}.`;
  if (/\bplaygrounds?\b|游乐场/.test(prompt.toLowerCase())) notes.push('The playground is shown as a small park in this first version.');
  if (/\bschools?\b|学校/.test(prompt.toLowerCase())) notes.push('The school uses a simple civic building model.');
  return { plan, recognized: interpreted.recognized, message: [initial, ...notes].join(' ') };
}
