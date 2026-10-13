import { describe, expect, it } from 'vitest';
import { createLayout, parseLayout } from './layout';
import { restoreFleet, snapshotFleetLayout } from './fleet';
import { generateScenery } from './sceneryGeneration';
import { saveDesignSnapshot } from './savedDesigns';

describe('scenery travels with the existing railway save', () => {
  it.each(['kato-plan02', 'kato-plan06-15'] as const)('round-trips scenery without altering the %s railway or fleet', preset => {
    const original = createLayout(preset);
    const scenery = generateScenery(original.tracks, original.accessories, {
      theme: 'city', density: 'balanced', features: ['buildings', 'roads', 'cars', 'trees', 'people'], prompt: 'A city with shops and apartments', seed: 91,
    }).plan!;
    const decorated = parseLayout(JSON.parse(JSON.stringify({ ...original, scenery })));
    const { scenery: restored, ...railway } = decorated;
    expect(railway).toEqual(original);
    expect(restored).toEqual(scenery);
    const fleet = restoreFleet(decorated);
    fleet[0].running = true;
    fleet[0].actualSpeed = 20;
    const snapshot = snapshotFleetLayout(decorated, fleet, fleet[0].id, decorated.couplings ?? []);
    const reopened = parseLayout(JSON.parse(JSON.stringify(snapshot)));
    expect(reopened.scenery).toEqual(scenery);
    expect(reopened.tracks).toEqual(original.tracks);
    expect(reopened.accessories).toEqual(original.accessories);
    expect(reopened.trains).toEqual(snapshot.trains);
    expect(fleet[0].running).toBe(true);
    expect(fleet[0].actualSpeed).toBe(20);
  });

  it('named design snapshots own their scenery independently of later edits', () => {
    const original = createLayout('compact');
    const scenery = generateScenery(original.tracks, original.accessories, {
      theme: 'countryside', density: 'quiet', features: ['buildings', 'trees', 'roads', 'cars'], prompt: '', seed: 18,
    }).plan!;
    const expected = structuredClone(scenery);
    const saved = saveDesignSnapshot({ version: 1, designs: [] }, { ...original, scenery }, 'Our village', null, false,
      { id: 'scenery-save', updatedAt: '2026-10-13T08:00:00Z' });
    scenery.objects[0].x += 200;
    scenery.trafficPlaying = false;
    expect(saved.design.layout.scenery).toEqual(expected);
    expect(saved.design.layout.name).toBe('Our village');
    expect(saved.design.layout.tracks).toEqual(original.tracks);
  });

  it('keeps older saves undecorated and rejects an invalid scenery extension', () => {
    const original = createLayout('compact');
    expect(parseLayout(original)).not.toHaveProperty('scenery');
    expect(() => parseLayout({ ...original, scenery: { version: 100 } })).toThrow(/scenery/i);
    expect(() => parseLayout({ ...original, scenery: null })).toThrow(/scenery/i);
  });
});
