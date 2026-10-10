import { describe, expect, it } from 'vitest';
import { defaultStationName, supportsStationName } from './stationName';

describe('station sign defaults', () => {
  it('permits customization only for platforms and station buildings', () => {
    expect(supportsStationName('platform')).toBe(true);
    expect(supportsStationName('station')).toBe(true);
    for (const type of ['building', 'catenary', 'pier', 'unknown', undefined]) {
      expect(supportsStationName(type)).toBe(false);
    }
  });

  it('keeps the original default names on platforms and station buildings', () => {
    expect(defaultStationName('platform')).toBe('原宿 Harajuku');
    expect(defaultStationName('station')).toBe('東京 Tokyo');
  });
});
