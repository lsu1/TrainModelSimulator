import { KATO_CATALOG } from './catalog';
import type { PlacedAccessory } from './layout';
import { pathsFor } from './track';
import type { Track } from './track';
import { SCENERY_LIMITS } from './sceneryTypes';
import type { SceneryBounds, SceneryFeature, SceneryObject, SceneryPlan, SceneryPoint, SceneryRequest, SceneryResult, SceneryRoad, ScenerySurface } from './sceneryTypes';

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
function radius(object: Pick<SceneryObject, 'width' | 'depth'>): number { return Math.hypot(object.width, object.depth) / 2; }
function sampleLine(a: SceneryPoint, b: SceneryPoint, visit: (point: SceneryPoint) => void): void {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / SAMPLE));
  for (let i = 0; i <= steps; i++) visit({ x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps });
}
function samplePath(points: readonly SceneryPoint[], closed: boolean, visit: (point: SceneryPoint) => void): void {
  for (let i = 1; i < points.length; i++) sampleLine(points[i - 1], points[i], visit);
  if (closed && points.length > 2) sampleLine(points[points.length - 1], points[0], visit);
}
function pathLength(points: readonly SceneryPoint[], closed: boolean): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  if (closed && points.length > 2) length += Math.hypot(points[0].x - points[points.length - 1].x, points[0].y - points[points.length - 1].y);
  return length;
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
function roundRoad(bounds: SceneryBounds, id: string, width = 60): SceneryRoad {
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
  return { id, points, width, closed: true };
}

/** Lot fronts can meet the pavement without their circumscribed circle pushing
 * them far away. Railway clearance still protects that entire larger circle. */
function clearOfRoad(object: SceneryObject, road: SceneryRoad): boolean {
  if (!object.lot) return distanceToPath(object, road) >= road.width / 2 + radius(object) + (object.kind === 'person' ? 2 : 12);
  if (distanceToPath(object, road) >= road.width / 2 + radius(object) + 12 + SAMPLE / 2) return true;
  const c = Math.cos(object.angle), s = Math.sin(object.angle);
  let clear = true;
  samplePath(road.points, road.closed, point => {
    if (!clear) return;
    const x = (point.x - object.x) * c + (point.y - object.y) * s;
    const y = -(point.x - object.x) * s + (point.y - object.y) * c;
    const distance = Math.hypot(Math.max(0, Math.abs(x) - object.width / 2), Math.max(0, Math.abs(y) - object.depth / 2));
    if (distance < road.width / 2 + 12 + SAMPLE / 2) clear = false;
  });
  return clear;
}

/** Build local streets only out of uninterrupted, physically clear ground.
 * Some railway loops necessarily enclose a separate neighbourhood; no crossing
 * or hidden bridge is invented to connect it to the perimeter arterial. */
function neighbourhoodRoads(bounds: SceneryBounds, obstacles: Footprints, seed: number): SceneryRoad[] {
  const width = 44, clearance = width / 2 + 12 + SAMPLE / 2;
  const spanX = bounds.maxX - bounds.minX, spanY = bounds.maxY - bounds.minY;
  const candidates: { road: SceneryRoad; score: number; orientation: number }[] = [];
  let serial = 0;
  const proportions = [.5, .25, .75, .125, .875];
  for (let orientation = 0; orientation < 2; orientation++) {
    const start = orientation ? bounds.minY - 135 : bounds.minX - 135;
    const end = orientation ? bounds.maxY + 135 : bounds.maxX + 135;
    for (const fraction of proportions) {
      const cross = orientation ? bounds.minX + spanX * fraction : bounds.minY + spanY * fraction;
      let runStart: number | undefined;
      const finish = (last: number) => {
        if (runStart === undefined) return;
        // Leave a small landscaped end before any protected rail envelope.
        const a = runStart + 18, b = last - 18;
        if (b - a >= 240) {
          const points = orientation ? [{ x: cross, y: a }, { x: cross, y: b }] : [{ x: a, y: cross }, { x: b, y: cross }];
          const road: SceneryRoad = { id: `scenery-street-${seed}-${serial++}`, points, width, closed: false };
          if (safePath(points, width, false, obstacles, 12)) candidates.push({ road, score: b - a, orientation });
        }
        runStart = undefined;
      };
      for (let coordinate = start; coordinate <= end + 24; coordinate += 24) {
        const point = orientation ? { x: cross, y: coordinate } : { x: coordinate, y: cross };
        if (coordinate <= end && obstacles.clear(point, clearance)) runStart ??= coordinate;
        else finish(Math.min(end, coordinate - 24));
      }
    }
  }
  const maximum = Math.min(7, Math.max(1, Math.floor(spanX * spanY / 450000)));
  const selected: SceneryRoad[] = [];
  // Alternate the orientations rather than selecting only long parallel lines.
  for (let i = 0; i < maximum; i++) {
    const preferred = i % 2;
    const ordered = [...candidates].sort((a, b) => Number(b.orientation === preferred) - Number(a.orientation === preferred) || b.score - a.score);
    const next = ordered.find(candidate => !selected.includes(candidate.road) && selected.every(road => {
      const p = road.points[0], q = candidate.road.points[0];
      const horizontal = road.points[0].y === road.points[1].y;
      if (horizontal !== (candidate.orientation === 0)) return true;
      return Math.abs(horizontal ? p.y - q.y : p.x - q.x) >= 180;
    }));
    if (!next) break;
    selected.push(next.road);
  }
  return selected;
}

interface StreetFront extends SceneryPoint { angle: number; road: SceneryRoad; side: number; segment: number }
/** Frontages are a regular row of plots, never a random cloud of buildings. */
function streetFronts(roads: readonly SceneryRoad[], spacing: number, phase = 0): StreetFront[] {
  const fronts: StreetFront[] = [];
  for (const road of roads) for (let segment = 0; segment < road.points.length - (road.closed ? 0 : 1); segment++) {
    const a = road.points[segment], b = road.points[(segment + 1) % road.points.length];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < spacing * .75) continue; // Rounded corners get trees, not oddly angled tower rows.
    const count = Math.max(1, Math.floor((length - 40) / spacing));
    for (let i = 0; i < count; i++) {
      const t = (i + .5 + phase) / count;
      if (t <= 0 || t >= 1) continue;
      for (const side of [-1, 1]) fronts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
        angle: Math.atan2(b.y - a.y, b.x - a.x), road, side, segment });
    }
  }
  return fronts;
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
    return obstacles.clear(object, r) && water.clear(object, r) && roads.every(road => clearOfRoad(object, road));
  });
  const surfaces = plan.surfaces?.filter(surface => obstacles.clear(surface, radius(surface)) && water.clear(surface, radius(surface)));
  const roadIds = new Set(roads.map(road => road.id));
  const cars = plan.cars.filter(car => roadIds.has(car.roadId));
  if (roads.length === plan.roads.length && rivers.length === plan.rivers.length && objects.length === plan.objects.length && cars.length === plan.cars.length && surfaces?.length === plan.surfaces?.length) return plan;
  return { ...plan, roads, rivers, objects, cars, ...(surfaces ? { surfaces } : {}) };
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
  const urban = interpreted.theme === 'city';
  const sceneBounds = previous?.bounds ?? expand(railBounds, urban ? 380 : 460);
  if (Math.max(Math.abs(sceneBounds.minX), Math.abs(sceneBounds.maxX), Math.abs(sceneBounds.minY), Math.abs(sceneBounds.maxY)) > SCENERY_LIMITS.coordinate) return { plan: null, recognized: interpreted.recognized, message: 'This railway is too close to the scenery coordinate boundary. Move the railway nearer the centre before building surroundings.' };
  const plan: SceneryPlan = {
    version: 1, seed, theme: previous?.theme ?? interpreted.theme, density: interpreted.density,
    features: previous ? [...new Set([...previous.features, ...interpreted.features])] : interpreted.features,
    prompt: prompt.slice(0, SCENERY_LIMITS.prompt), bounds: { ...sceneBounds }, objects: [],
    roads: previous?.roads ?? [], rivers: previous?.rivers ?? [], cars: previous?.cars ?? [],
    trafficPlaying: previous?.trafficPlaying ?? true,
    ...(urban || previous?.style === 'urban-v2' ? { style: 'urban-v2' as const, surfaces: [] } : {}),
  };
  const notes: string[] = [];
  // An explicit local request such as "a playground here" does not inherit the
  // global City's Buildings checkbox and replace the playground with towers.
  const features = new Set(local && interpreted.mentionedFeatures.length ? interpreted.mentionedFeatures : interpreted.features);
  if (local) {
    // A marked circle selects centres, but new footprints must fit wholly inside.
    // Untouched saved objects retain identity, dimensions and style.
    plan.objects = (previous?.objects ?? []).filter(object => Math.hypot(object.x - area!.x, object.y - area!.y) > area!.radius);
    if (previous?.surfaces) plan.surfaces = previous.surfaces.filter(surface => Math.hypot(surface.x - area!.x, surface.y - area!.y) > area!.radius);
    if (features.has('roads') || features.has('cars') || features.has('river')) notes.push(previous ? 'Existing roads, river routes and traffic are kept; area changes place scenery beside them.' : 'Build the whole surroundings first to add a connected road, moving traffic or river.');
  } else {
    if (features.has('roads')) {
      const road = roundRoad(expand(railBounds, 135), `scenery-road-${seed}`, urban ? 68 : 60);
      if (safePath(road.points, road.width, true, obstacles, 12)) plan.roads.push(road);
      else notes.push('There was not enough room for a safe connected road.');
      if (urban) {
        let total = plan.roads.reduce((sum, item) => sum + pathLength(item.points, item.closed), 0);
        // Leave room for the requested river before choosing more local streets.
        // Very wide custom railways still produce plans accepted by the importer.
        const riverReserve = features.has('river') ? sceneBounds.maxX - sceneBounds.minX + 60 : 0;
        for (const street of neighbourhoodRoads(railBounds, obstacles, seed)) {
          const length = pathLength(street.points, street.closed);
          if (total + length + riverReserve > SCENERY_LIMITS.pathLength) continue;
          plan.roads.push(street); total += length;
        }
      }
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
      const total = plan.roads.reduce((sum, item) => sum + pathLength(item.points, item.closed), 0) + pathLength(points, false);
      if (total <= SCENERY_LIMITS.pathLength && safePath(points, 58, false, obstacles, 8) && safePath(points, 58, false, roadSpace, 8)) plan.rivers.push({ id: `scenery-river-${seed}`, points, width: 58 });
      else notes.push('The river could not fit safely into this scene.');
    }
    const trafficRoad = plan.roads.find(road => road.closed);
    if (features.has('cars') && trafficRoad) {
      const road = trafficRoad, count = interpreted.density === 'busy' ? 24 : interpreted.density === 'quiet' ? 8 : 14;
      for (let i = 0; i < count; i++) plan.cars.push({ id: `scenery-car-${seed}-${i}`, roadId: road.id,
        lane: i % 2 ? -1 : 1, phase: (Math.floor(i / 2) + (i % 2 ? .45 : 0)) / Math.ceil(count / 2),
        speed: 28, kind: i % 9 === 0 ? 'bus' : i % 5 === 0 ? 'van' : 'car', variant: Math.floor(rng() * 8) });
    } else if (features.has('cars')) notes.push('Moving vehicles need a safe closed road; only clear local streets could be placed here.');
  }
  const used = new Footprints(), water = new Footprints();
  const usedIds = new Set([...plan.objects, ...plan.roads, ...plan.rivers, ...plan.cars, ...(plan.surfaces ?? [])].map(item => item.id));
  for (const object of plan.objects) used.add({ ...object, radius: radius(object) + 4 });
  for (const river of plan.rivers) pathFootprint(river.points, river.width, false, water, 10);
  let serial = 0;
  const accepted: Record<string, number> = {};
  function place(object: SceneryObject): boolean {
    const r = radius(object);
    if (plan.objects.length >= SCENERY_LIMITS.objects || !inside(object, sceneBounds, r)) return false;
    if (area && Math.hypot(object.x - area.x, object.y - area.y) + r > area.radius) return false;
    if (!obstacles.clear(object, r) || !used.clear(object, r + 4) || !water.clear(object, r)) return false;
    if (plan.roads.some(road => !clearOfRoad(object, road))) return false;
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
  function placeSurface(kind: ScenerySurface['kind'], point: SceneryPoint, width: number, depth: number, angle: number, variant = 0): void {
    if (!plan.surfaces || plan.surfaces.length >= SCENERY_LIMITS.surfaces) return;
    const r = Math.hypot(width, depth) / 2;
    if (!inside(point, sceneBounds, r) || area && Math.hypot(point.x - area.x, point.y - area.y) + r > area.radius) return;
    if (!obstacles.clear(point, r) || !water.clear(point, r)) return;
    let id: string;
    do { id = `scenery-surface-${seed}-${serial++}`; } while (usedIds.has(id));
    usedIds.add(id);
    plan.surfaces.push({ x: point.x, y: point.y, id, kind, width, depth, angle, variant });
  }
  if (!interpreted.remove && urban) {
    const density = interpreted.density === 'busy' ? 1.25 : interpreted.density === 'quiet' ? .65 : 1;
    const availableArea = (areaBounds.maxX - areaBounds.minX) * (areaBounds.maxY - areaBounds.minY);
    const sizeFactor = Math.min(1.8, Math.max(.45, Math.sqrt(availableArea / 2600000)));
    const targetBuildings = features.has('buildings') ? Math.max(1, Math.round(65 * density * sizeFactor)) : 0;
    const targetParks = features.has('parks') ? Math.max(1, Math.round(9 * density * sizeFactor)) : 0;
    const targetTrees = features.has('trees') ? Math.max(1, Math.round(115 * density * sizeFactor)) : 0;
    const targetPeople = features.has('people') ? Math.max(1, Math.round(45 * density * sizeFactor)) : 0;
    const buildingKinds: SceneryObject['kind'][] = interpreted.kinds.length ? interpreted.kinds : ['apartment', 'house', 'shop', 'office', 'house', 'apartment', 'shop'];
    // Even without visible Roads selected, buildings use a coherent frontage
    // arrangement instead of occupying random points in the railway field.
    const planningRoads = plan.roads.length ? plan.roads : [roundRoad(expand(railBounds, 135), `planning-${seed}`, 0), ...neighbourhoodRoads(railBounds, obstacles, seed)];
    const fronts = targetBuildings || targetParks ? streetFronts(planningRoads, interpreted.small ? 135 : 172, (seed % 7 - 3) * .04) : [];
    const parks: SceneryObject[] = [];
    const gardenCentres: { point: SceneryPoint; radius: number }[] = [];
    let buildings = 0, people = 0;
    const pointBeside = (front: StreetFront, distance: number): SceneryPoint => ({ x: front.x - Math.sin(front.angle) * distance * front.side, y: front.y + Math.cos(front.angle) * distance * front.side });
    const makeLot = (kind: SceneryObject['kind'], front: StreetFront): SceneryObject => {
      const object = candidate(kind, front.x, front.y);
      const size = (.9 + rng() * .15) * (interpreted.small ? .72 : 1);
      const sizes: Partial<Record<SceneryObject['kind'], [number, number, number]>> = {
        house: [112, 94, 47], shop: [128, 98, 48], apartment: [134, 112, 132], office: [148, 116, 122],
      };
      const dimensions = sizes[kind]!;
      object.width = dimensions[0] * size; object.depth = dimensions[1] * size;
      object.height = dimensions[2] * size * (interpreted.tall ? 1.6 : .85 + rng() * .5);
      object.lot = true;
      object.angle = front.angle + (front.side === 1 ? Math.PI : 0);
      Object.assign(object, pointBeside(front, front.road.width / 2 + object.depth / 2 + 22));
      return object;
    };
    // A closed railway loop may contain no usable street frontage. Find broad
    // clear interior pockets and organize them around a garden square, with
    // homes facing pedestrian paths rather than inventing a road across rails.
    if (targetParks || targetBuildings) {
      const pocketBounds = area ? areaBounds : railBounds;
      const columns = Math.max(1, Math.ceil((pocketBounds.maxX - pocketBounds.minX) / 96));
      const rows = Math.max(1, Math.ceil((pocketBounds.maxY - pocketBounds.minY) / 96));
      const cells = columns * rows, budget = Math.min(cells, 4096);
      const pockets: { point: SceneryPoint; radius: number }[] = [];
      const clearPocket = (point: SceneryPoint, r: number) => inside(point, pocketBounds, r) && inside(point, sceneBounds, r)
        && (!area || Math.hypot(point.x - area.x, point.y - area.y) + r <= area.radius)
        && obstacles.clear(point, r) && used.clear(point, r + 4) && water.clear(point, r)
        && plan.roads.every(road => distanceToPath(point, road) >= road.width / 2 + r + 12);
      for (let i = 0; i < budget; i++) {
        const index = Math.floor(i * cells / budget);
        const point = { x: pocketBounds.minX + (index % columns + .5) * (pocketBounds.maxX - pocketBounds.minX) / columns,
          y: pocketBounds.minY + (Math.floor(index / columns) + .5) * (pocketBounds.maxY - pocketBounds.minY) / rows };
        if (!clearPocket(point, 84)) continue;
        let low = 84, high = 260;
        for (let iteration = 0; iteration < 6; iteration++) {
          const middle = (low + high) / 2;
          if (clearPocket(point, middle)) low = middle; else high = middle;
        }
        pockets.push({ point, radius: low });
      }
      pockets.sort((a, b) => b.radius - a.radius || a.point.y - b.point.y || a.point.x - b.point.x);
      const maximum = area ? 1 : Math.min(7, Math.max(1, Math.round((railBounds.maxX - railBounds.minX) * (railBounds.maxY - railBounds.minY) / 650000)));
      for (const pocket of pockets) {
        if (gardenCentres.length >= maximum) break;
        if (gardenCentres.some(garden => Math.hypot(garden.point.x - pocket.point.x, garden.point.y - pocket.point.y) < garden.radius + pocket.radius + 90)) continue;
        const size = Math.min(1, pocket.radius / 122);
        let reserved = false;
        if (targetParks && parks.length < targetParks) {
          const park = candidate('park', pocket.point.x, pocket.point.y);
          park.width = 176 * size; park.depth = 144 * size; park.angle = seed % 2 ? Math.PI / 2 : 0;
          if (place(park)) {
            parks.push(park); reserved = true;
            placeSurface(park.variant % 3 ? 'lawn' : 'plaza', park, park.width + 10, park.depth + 10, park.angle, park.variant);
          }
        } else if (targetBuildings) {
          placeSurface('plaza', pocket.point, 142 * size, 118 * size, 0, seed % 8);
          reserved = true;
        }
        if (!reserved) continue;
        const gardenRadius = Math.hypot(176 * size, 144 * size) / 2;
        gardenCentres.push({ point: pocket.point, radius: gardenRadius });
        if (!targetBuildings) continue;
        for (let side = 0; side < 6 && buildings < targetBuildings; side++) {
          const angle = side * Math.PI / 3 + seed % 2 * Math.PI / 6;
          const kind = interpreted.kinds.length ? buildingKinds[side % buildingKinds.length] : side % 4 === 3 ? 'shop' : 'house';
          const front: StreetFront = { ...pocket.point, angle: angle + Math.PI / 2, road: planningRoads[0], side: -1, segment: 0 };
          const object = makeLot(kind, front); object.width *= .82; object.depth *= .86;
          const distance = gardenRadius + radius(object) + 12;
          object.x = pocket.point.x + Math.cos(angle) * distance; object.y = pocket.point.y + Math.sin(angle) * distance;
          if (!place(object)) continue;
          buildings++;
          const pathLength = distance - object.depth / 2;
          placeSurface('paving', { x: pocket.point.x + Math.cos(angle) * pathLength / 2, y: pocket.point.y + Math.sin(angle) * pathLength / 2 }, 14, pathLength + 8, object.angle, object.variant);
        }
      }
    }
    // Park and square parcels interrupt the street wall at regular intervals.
    // They are reserved before housing so greenery is part of the district.
    if (targetParks) for (let i = 0; i < fronts.length && parks.length < targetParks; i++) {
      const front = fronts[(i * 11 + seed % 5) % fronts.length];
      const park = candidate('park', front.x, front.y);
      park.width = 138; park.depth = 110; park.angle = front.angle;
      Object.assign(park, pointBeside(front, front.road.width / 2 + radius(park) + 14));
      if (place(park)) {
        parks.push(park);
        placeSurface(park.variant % 3 ? 'lawn' : 'plaza', park, park.width + 10, park.depth + 10, park.angle, park.variant);
      }
    }
    // Both sides of a street remain paired; varying the starting plot makes
    // Try another change the district without turning it into random scatter.
    for (let pass = 0; pass < 2 && buildings < targetBuildings; pass++) for (let i = 0; i < fronts.length && buildings < targetBuildings; i++) {
      const front = fronts[i], kind = buildingKinds[(i + seed + pass) % buildingKinds.length];
      const object = makeLot(kind, front);
      if (pass) { object.width *= .8; object.depth *= .8; Object.assign(object, pointBeside(front, front.road.width / 2 + object.depth / 2 + 22)); }
      if (!place(object)) continue;
      buildings++;
      const inward = { x: -Math.sin(object.angle), y: Math.cos(object.angle) };
      // A short paved entrance bridges the building lot to the pavement.
      placeSurface('paving', { x: object.x + inward.x * (object.depth / 2 + 8), y: object.y + inward.y * (object.depth / 2 + 8) }, object.width * .72, 28, object.angle, object.variant);
    }
    const treeFronts = targetTrees ? streetFronts(planningRoads, 54) : [];
    // Aligned garden strips occupy safe leftover land inside the railway, so
    // enclosing loops read as landscaped districts rather than an empty field.
    // Derive a point lazily: widely separated custom tracks must not allocate
    // a million-cell ground array just to place at most 400 scenery objects.
    const greenColumns = Math.max(0, Math.ceil((areaBounds.maxX - areaBounds.minX - 48) / 92));
    const greenRows = Math.max(0, Math.ceil((areaBounds.maxY - areaBounds.minY - 48) / 92));
    const greenCount = greenColumns * greenRows, greenBudget = Math.min(greenCount, 4096);
    const greenPoint = (sample: number): SceneryPoint | undefined => {
      if (!greenCount) return undefined;
      const index = (Math.floor(sample * greenCount / greenBudget) + seed % greenCount) % greenCount;
      return { x: areaBounds.minX + 48 + index % greenColumns * 92, y: areaBounds.minY + 48 + Math.floor(index / greenColumns) * 92 };
    };
    let trees = 0;
    const gardenTreePoints: SceneryPoint[] = [];
    // Small, varied clumps follow each square's garden edge; these fill the
    // interiors with planted neighbourhoods instead of an orchard-like grid.
    for (const garden of gardenCentres) for (let group = 0; group < 12; group++) {
      const angle = group * Math.PI / 6 + rng() * .2;
      const distance = garden.radius + 50 + rng() * 38;
      const centre = { x: garden.point.x + Math.cos(angle) * distance, y: garden.point.y + Math.sin(angle) * distance };
      for (let member = 0; member < 3; member++) gardenTreePoints.push({ x: centre.x + (rng() - .5) * 82, y: centre.y + (rng() - .5) * 82 });
    }
    if (targetTrees) for (let attempt = 0; attempt < gardenTreePoints.length + treeFronts.length + parks.length * 10 + greenBudget && trees < targetTrees; attempt++) {
      let point: SceneryPoint | undefined;
      if (attempt < gardenTreePoints.length) point = gardenTreePoints[attempt];
      else if (attempt < gardenTreePoints.length + treeFronts.length) {
        const front = treeFronts[attempt - gardenTreePoints.length]; point = pointBeside(front, front.road.width / 2 + 48);
      } else if (attempt < gardenTreePoints.length + treeFronts.length + parks.length * 10) {
        const index = attempt - gardenTreePoints.length - treeFronts.length, park = parks[Math.floor(index / 10)], a = index % 10 * Math.PI / 5;
        point = { x: park.x + Math.cos(a) * (radius(park) + 48), y: park.y + Math.sin(a) * (radius(park) + 48) };
      } else {
        const patch = Math.floor((attempt - gardenTreePoints.length - treeFronts.length - parks.length * 10) / 3);
        point = greenPoint(patch * 3);
        if (point) {
          const member = (attempt - gardenTreePoints.length - treeFronts.length - parks.length * 10) % 3;
          point = { x: point.x + (member === 1 ? 40 : member === 2 ? -28 : 0) + (rng() - .5) * 18,
            y: point.y + (member === 1 ? 28 : member === 2 ? 42 : 0) + (rng() - .5) * 18 };
        }
      }
      if (!point) continue;
      const tree = candidate('tree', point.x, point.y), size = .85 + rng() * .5;
      tree.width = tree.depth = 41 * size; tree.height = 51 * size;
      if (place(tree)) {
        trees++;
        if (trees % 3 === 0) placeSurface('garden', tree, 43, 43, 0, tree.variant);
      }
    }
    const pedestrianFronts = targetPeople ? streetFronts(planningRoads, 38, .1) : [];
    if (targetPeople) for (let attempt = 0; attempt < pedestrianFronts.length && people < targetPeople; attempt++) {
      const front = pedestrianFronts[(attempt * 7 + seed) % pedestrianFronts.length], point = pointBeside(front, front.road.width / 2 + 8);
      const person = candidate('person', point.x, point.y); person.angle = front.angle;
      if (place(person)) people++;
    }
    // Marked park/tree-only edits may fall away from every existing street.
    // Use a regular compact planted patch there, retaining all outside parcels.
    if (area && targetParks && !parks.length) {
      const park = candidate('park', area.x, area.y); park.width = 118; park.depth = 96;
      if (place(park)) { parks.push(park); placeSurface('lawn', park, 124, 102, 0, park.variant); }
    }
    if (targetBuildings && !buildings) notes.push('Buildings do not fit in this area; try a larger area or smaller buildings.');
    else if (targetBuildings && buildings < targetBuildings / 3) notes.push('The railway leaves only a few safe building plots; its tracks stay clear.');
    if (targetPeople && !people) notes.push('There was no clear pavement for people in this area.');
  } else if (!interpreted.remove) {
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
  const initial = interpreted.remove ? 'Scenery in the marked area is cleared.' : `${local ? 'Area preview' : 'Surroundings preview'}: ${changed} scenery objects${local ? '' : `, ${plan.roads.length} road${plan.roads.length === 1 ? '' : 's'} and ${plan.cars.length} moving vehicles`}.`;
  if (/\bplaygrounds?\b|游乐场/.test(prompt.toLowerCase())) notes.push('The playground is shown as a small park in this first version.');
  if (/\bschools?\b|学校/.test(prompt.toLowerCase())) notes.push('The school uses a simple civic building model.');
  return { plan, recognized: interpreted.recognized, message: [initial, ...notes].join(' ') };
}
