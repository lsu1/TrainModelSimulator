import { KATO_CATALOG } from './catalog';
import { endpoints, makeCityLayout, makeStarterLayout, makeViaductLayout } from './track';
import type { Track } from './track';

export interface PlacedAccessory {
  id: string;
  kind: string;
  x: number;
  y: number;
  angle: number;
  elevation: number;
}

export interface LayoutData {
  version: 2;
  name: string;
  tracks: Track[];
  accessories: PlacedAccessory[];
  carCount: number;
}

export const STORAGE_KEY = 'little-railways-layout-v2';
export const LEGACY_STORAGE_KEY = 'little-railways-layout-v1';
const MAX_PIECES = 300;
const CATALOG = new Map(KATO_CATALOG.map((item) => [item.kind, item]));

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validCoordinate(value: unknown, limit: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;
}

function validElevation(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 500;
}

/** Import only supported fields, including when migrating the original 2D saves. */
export function parseLayout(value: unknown): LayoutData {
  if (!isObject(value)) throw new Error('This is not a railway layout.');
  const candidate = value;
  if ((candidate.version !== 1 && candidate.version !== 2)
    || typeof candidate.name !== 'string' || !Array.isArray(candidate.tracks)) {
    throw new Error('Choose a layout saved by Little Railways.');
  }
  const accessoriesData = candidate.version === 1 ? [] : candidate.accessories;
  if (!Array.isArray(accessoriesData)) throw new Error('This layout has an invalid accessories list.');
  const carCount = candidate.version === 1 ? 11 : candidate.carCount;
  if (typeof carCount !== 'number' || !Number.isInteger(carCount) || carCount < 3 || carCount > 11) {
    throw new Error('Choose a train with 3 to 11 cars.');
  }
  if (candidate.tracks.length + accessoriesData.length > MAX_PIECES) {
    throw new Error(`This railway has more than ${MAX_PIECES} pieces.`);
  }

  const ids = new Set<string>();
  const switchNumbers = new Set<number>();
  let highestSwitchNumber = 0;
  function validatePlacement(item: Record<string, unknown>, message: string): void {
    if (typeof item.id !== 'string' || !item.id.trim() || item.id.length > 100 || ids.has(item.id)
      || !validCoordinate(item.x, 50000) || !validCoordinate(item.y, 50000)
      || !validCoordinate(item.angle, 1000)) throw new Error(message);
    ids.add(item.id);
  }

  const tracks = candidate.tracks.map((value: unknown): Track => {
    const error = 'This layout contains an invalid track piece.';
    if (!isObject(value)) throw new Error(error);
    const item = value;
    validatePlacement(item, error);
    const spec = typeof item.kind === 'string' ? CATALOG.get(item.kind) : undefined;
    const elevation = item.elevation === undefined ? 0 : item.elevation;
    const endElevation = item.endElevation === undefined ? elevation : item.endElevation;
    if (!spec || spec.category === 'accessory' || (item.bend !== 1 && item.bend !== -1)
      || !validElevation(elevation) || !validElevation(endElevation)) throw new Error(error);
    if (item.switchState !== undefined && item.switchState !== 'straight' && item.switchState !== 'branch') {
      throw new Error(error);
    }
    if (item.switchNumber !== undefined) {
      if ((spec.shape !== 'turnout' && spec.shape !== 'scissors')
        || typeof item.switchNumber !== 'number' || !Number.isSafeInteger(item.switchNumber)
        || item.switchNumber <= 0 || switchNumbers.has(item.switchNumber)) {
        throw new Error('This layout contains an invalid or duplicate switch number.');
      }
      switchNumbers.add(item.switchNumber);
      highestSwitchNumber = Math.max(highestSwitchNumber, item.switchNumber);
    }
    if (item.route !== undefined) {
      const routeCount = spec.shape === 'scissors' ? 4
        : spec.shape === 'turnout' || spec.shape === 'crossing'
          || spec.shape === 'doubleStraight' || spec.shape === 'doubleCurve' ? 2 : 1;
      if (typeof item.route !== 'number' || !Number.isInteger(item.route)
        || item.route < 0 || item.route >= routeCount) throw new Error(error);
    }
    return {
      id: item.id as string,
      kind: spec.kind,
      x: item.x as number,
      y: item.y as number,
      angle: item.angle as number,
      bend: item.bend,
      elevation,
      endElevation,
      ...(item.switchState === undefined ? {} : { switchState: item.switchState as 'straight' | 'branch' }),
      ...(item.switchNumber === undefined ? {} : { switchNumber: item.switchNumber as number }),
      ...(item.route === undefined ? {} : { route: item.route as number }),
    };
  });
  // Reserve every existing number first so older saves can acquire stable
  // labels without renumbering switches whose labels were already saved.
  for (const track of tracks) {
    const shape = CATALOG.get(track.kind)!.shape;
    if ((shape === 'turnout' || shape === 'scissors') && track.switchNumber === undefined) {
      highestSwitchNumber += 1;
      if (!Number.isSafeInteger(highestSwitchNumber)) throw new Error('This layout has no available switch numbers.');
      track.switchNumber = highestSwitchNumber;
    }
  }

  const accessories = accessoriesData.map((value: unknown): PlacedAccessory => {
    const error = 'This layout contains an invalid accessory.';
    if (!isObject(value)) throw new Error(error);
    const item = value;
    validatePlacement(item, error);
    const spec = typeof item.kind === 'string' ? CATALOG.get(item.kind) : undefined;
    const elevation = item.elevation === undefined ? 0 : item.elevation;
    if (!spec || spec.category !== 'accessory' || !validElevation(elevation)) throw new Error(error);
    return {
      id: item.id as string,
      kind: spec.kind,
      x: item.x as number,
      y: item.y as number,
      angle: item.angle as number,
      elevation,
    };
  });

  return {
    version: 2,
    name: candidate.name.trim().slice(0, 60) || 'My Railway',
    tracks,
    accessories,
    carCount,
  };
}

export type LayoutPreset = 'city' | 'viaduct' | 'empty' | 'compact';

/** Ready-to-play scenery keeps its catalog identity when saved or exported. */
export function createLayout(kind: LayoutPreset = 'city'): LayoutData {
  const tracks = kind === 'city' ? makeCityLayout()
    : kind === 'viaduct' ? makeViaductLayout()
      : kind === 'compact' ? makeStarterLayout('compact') : [];
  const accessories: PlacedAccessory[] = [];
  if (kind === 'city' || kind === 'viaduct') {
    const elevation = kind === 'viaduct' ? 60 : 0;
    const northTrackY = tracks[0]?.y ?? -381;
    const place = (type: 'platform' | 'station' | 'catenary' | 'pier' | 'building', x: number, y: number, height = elevation) => {
      const spec = KATO_CATALOG.find((item) => item.category === 'accessory' && item.accessoryType === type);
      if (spec) accessories.push({ id: `starter-${type}-${accessories.length + 1}`, kind: spec.kind, x, y, angle: 0, elevation: height });
    };
    place('platform', 0, northTrackY + 31);
    place('station', 0, northTrackY + 101);
    place('building', kind === 'viaduct' ? -220 : 140, 60, 0);
    place('catenary', -370, northTrackY);
    place('catenary', 370, northTrackY);
    if (kind === 'viaduct') {
      const support = KATO_CATALOG.find((item) => item.kind === 'a-pier-tapered' && item.supportDeckHeight === elevation)
        ?? KATO_CATALOG.find((item) => item.category === 'accessory' && item.accessoryType === 'pier' && item.supportDeckHeight === elevation);
      if (!support) throw new Error('A catalog support for the viaduct height is unavailable.');
      const joints: { x: number; y: number }[] = [];
      for (const track of tracks) for (const endpoint of endpoints(track)) {
        const { x, y, z = 0 } = endpoint.position;
        if (Math.abs(z - elevation) > .25 || joints.some((joint) => Math.hypot(joint.x - x, joint.y - y) <= .25)) continue;
        joints.push({ x, y });
        accessories.push({ id: `starter-pier-${joints.length}`, kind: support.kind, x, y, angle: endpoint.angle, elevation: 0 });
      }
    }
  }
  return parseLayout({
    version: 2,
    name: kind === 'city' ? 'Tokyo Railway' : kind === 'viaduct' ? 'Sky Railway' : kind === 'compact' ? 'Small Railway' : 'My Railway',
    tracks,
    accessories,
    carCount: kind === 'compact' ? 3 : 11,
  });
}

/** Prefer the current save; recover the earlier 2D layout before using a starter. */
export function loadLayout(): LayoutData {
  for (const key of [STORAGE_KEY, LEGACY_STORAGE_KEY]) {
    try {
      const saved = localStorage.getItem(key);
      if (saved) return parseLayout(JSON.parse(saved));
    } catch { /* An unavailable or corrupt save must not prevent playing. */ }
  }
  return createLayout('city');
}
