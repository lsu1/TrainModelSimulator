import { TRACK_CATALOG, makeStarterLayout } from './track';
import type { Track } from './track';

export interface LayoutData { version: 1; name: string; tracks: Track[] }
export const STORAGE_KEY = 'little-railways-layout-v1';

export function parseLayout(value: unknown): LayoutData {
  if (!value || typeof value !== 'object') throw new Error('This is not a railway layout.');
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1 || typeof candidate.name !== 'string' || !Array.isArray(candidate.tracks)) {
    throw new Error('Choose a layout saved by Little Railways.');
  }
  if (candidate.tracks.length > 200) throw new Error('This railway has more than 200 track pieces.');
  const ids = new Set<string>();
  const tracks = candidate.tracks.map((value: unknown): Track => {
    if (!value || typeof value !== 'object') throw new Error('A track piece is missing.');
    const t = value as Record<string, unknown>;
    if (typeof t.id !== 'string' || !t.id.trim() || t.id.length > 100 || ids.has(t.id) || !TRACK_CATALOG.some(k => k.kind === t.kind)
      || ![t.x, t.y, t.angle].every(n => typeof n === 'number' && Number.isFinite(n))
      || Math.abs(t.x as number) > 50000 || Math.abs(t.y as number) > 50000 || Math.abs(t.angle as number) > 1000
      || (t.bend !== 1 && t.bend !== -1)) throw new Error('This layout contains an invalid track piece.');
    ids.add(t.id);
    return { id: t.id, kind: t.kind as Track['kind'], x: t.x as number, y: t.y as number, angle: t.angle as number, bend: t.bend };
  });
  return { version: 1, name: candidate.name.trim().slice(0, 60) || 'My Railway', tracks };
}

export function loadLayout(): LayoutData {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return parseLayout(JSON.parse(saved));
  } catch { /* An unavailable or corrupt save must not prevent playing. */ }
  return { version: 1, name: 'Sunny Valley', tracks: makeStarterLayout('oval') };
}
