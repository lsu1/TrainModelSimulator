export const MAX_STATION_NAME_LENGTH = 60;

/** Platforms and station buildings have signs that can display a station name. */
export function supportsStationName(accessoryType?: string): boolean {
  return accessoryType === 'platform' || accessoryType === 'station';
}

/** Keep the original signs for existing layouts and accessories without a custom name. */
export function defaultStationName(accessoryType?: string): string {
  return accessoryType === 'station' ? '東京 Tokyo' : '原宿 Harajuku';
}

/** Blank names restore the original sign; imported names must fit the same editor limit. */
export function normalizeStationName(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error('This station name must be text.');
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name) return undefined;
  if (name.length > MAX_STATION_NAME_LENGTH) {
    throw new Error(`Choose a station name with ${MAX_STATION_NAME_LENGTH} characters or fewer.`);
  }
  return name;
}
