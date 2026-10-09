import { describe, expect, it, vi } from 'vitest';
import { STORAGE_KEY, PREVIOUS_STORAGE_KEY, V3_STORAGE_KEY, V2_STORAGE_KEY, createLayout, parseLayout } from './layout';
import { restoreFleet, snapshotFleetLayout } from './fleet';
import {
  DESIGN_RECOVERY_PREFIX,
  SAVED_DESIGNS_KEY,
  persistSavedDesigns,
  readSavedDesigns,
  readWorkingDesignId,
  removeDesignSnapshot,
  saveDesignSnapshot,
  validateDesignName,
} from './savedDesigns';
import type { SavedDesignLibrary } from './savedDesigns';

const empty = (): SavedDesignLibrary => ({ version: 1, designs: [] });
const timestamp = '2026-10-07T08:00:00.000Z';
function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
  };
}
function library() {
  const a = saveDesignSnapshot(empty(), createLayout('kato-plan02'), 'Bridge railway', null, false,
    { id: 'design-a', updatedAt: timestamp });
  return saveDesignSnapshot(a.library, createLayout('compact'), 'Small railway', null, false,
    { id: 'design-b', updatedAt: timestamp }).library;
}

describe('named design snapshots', () => {
  it('saves the entire 3D layout independently of the working layout and restores it after reload', () => {
    const working = createLayout('kato-plan02');
    working.carCount = 5;
    working.tracks.find((track) => track.switchNumber === 1)!.switchState = 'branch';
    const result = saveDesignSnapshot(empty(), working, '  Our viaduct  ', null, false,
      { id: 'our-viaduct', updatedAt: timestamp });
    expect(result.design.name).toBe('Our viaduct');
    expect(result.design.layout).toEqual({ ...working, name: 'Our viaduct' });
    expect(result.design.layout).not.toBe(working);
    expect(result.design.layout.tracks[0]).not.toBe(working.tracks[0]);
    expect(result.design.layout.accessories[0]).not.toBe(working.accessories[0]);
    const stored = storage();
    persistSavedDesigns(result.library, null, stored);
    working.tracks[0].x += 200;
    working.accessories[0].elevation = 40;
    working.carCount = 11;
    const reopened = readSavedDesigns(stored);
    expect(reopened.error).toBeNull();
    expect(reopened.library).toEqual(result.library);
    expect(reopened.library.designs[0].layout.sourcePlan).toBe('kato-plan02-1a');
    expect(reopened.library.designs[0].layout.carCount).toBe(5);
    expect(reopened.library.designs[0].layout.tracks.find((track) => track.switchNumber === 1)?.switchState).toBe('branch');
    const openCopy = parseLayout(reopened.library.designs[0].layout);
    openCopy.tracks[0].x -= 300;
    expect(reopened.library).toEqual(result.library);
  });

  it('replaces the active design by ID while preserving another design and the original library', () => {
    const original = library();
    const originalJson = JSON.stringify(original);
    const changed = { ...createLayout('empty'), carCount: 7 };
    const result = saveDesignSnapshot(original, changed, 'A changed design', 'design-a', false,
      { updatedAt: '2026-10-07T09:00:00.000Z' });
    expect(result.library.designs).toHaveLength(2);
    expect(result.design).toMatchObject({ id: 'design-a', name: 'A changed design', updatedAt: '2026-10-07T09:00:00.000Z' });
    expect(result.design.layout).toMatchObject({ name: 'A changed design', tracks: [], carCount: 7 });
    expect(result.library.designs[1]).toEqual(original.designs[1]);
    expect(JSON.stringify(original)).toBe(originalJson);
  });

  it('saves a copy under a fresh ID even when its name matches an existing design', () => {
    const original = library();
    const result = saveDesignSnapshot(original, createLayout('empty'), original.designs[0].name, 'design-a', true,
      { id: 'design-copy', updatedAt: timestamp });
    expect(result.design.id).toBe('design-copy');
    expect(result.library.designs).toHaveLength(3);
    expect(result.library.designs.slice(0, 2)).toEqual(original.designs);
    expect(result.library.designs[2].layout.tracks).toHaveLength(0);
  });

  it('creates a new design when the active saved design was deleted elsewhere', () => {
    const result = saveDesignSnapshot(library(), createLayout('empty'), 'Recovered idea', 'deleted-id', false,
      { id: 'new-id', updatedAt: timestamp });
    expect(result.library.designs).toHaveLength(3);
    expect(result.design.id).toBe('new-id');
  });

  it('removes only the named snapshot and never mutates an opened railway', () => {
    const original = library();
    const opened = parseLayout(original.designs[0].layout);
    const result = removeDesignSnapshot(original, 'design-a');
    expect(result.designs.map((design) => design.id)).toEqual(['design-b']);
    expect(original.designs).toHaveLength(2);
    expect(opened).toEqual(original.designs[0].layout);
    expect(removeDesignSnapshot(result, 'already-deleted')).toBe(result);
  });

  it('requires an explicit nonempty name of at most 60 characters', () => {
    expect(validateDesignName('  Our railway  ')).toBe('Our railway');
    expect(validateDesignName('x'.repeat(60))).toHaveLength(60);
    for (const name of ['', '  ', 'x'.repeat(61)]) {
      expect(() => saveDesignSnapshot(empty(), createLayout('compact'), name, null)).toThrow(/name/);
    }
  });

  it('rejects invalid layouts and colliding new IDs instead of replacing another design', () => {
    const original = library();
    expect(() => saveDesignSnapshot(original, { ...createLayout('empty'), carCount: 12 }, 'Invalid', null)).toThrow(/3 to 11/);
    expect(() => saveDesignSnapshot(original, createLayout('empty'), 'Copy', 'design-a', true,
      { id: 'design-b', updatedAt: timestamp })).toThrow(/already in use/);
    expect(original.designs).toHaveLength(2);
  });
});

describe('library storage and recovery', () => {
  it('reads an absent library without creating or changing any browser save', () => {
    const stored = storage();
    expect(readSavedDesigns(stored)).toEqual({ library: empty(), recoveryRaw: null, error: null, unavailable: false });
    expect(stored.setItem).not.toHaveBeenCalled();
  });

  it('keeps valid entries from a damaged library and preserves the original raw data until mutation', () => {
    const original = library();
    const raw = JSON.stringify({ version: 1, designs: [original.designs[0],
      { ...original.designs[1], layout: { ...original.designs[1].layout, carCount: 2 } }, original.designs[0]] });
    const stored = storage({ [SAVED_DESIGNS_KEY]: raw });
    const result = readSavedDesigns(stored);
    expect(result.library.designs).toEqual([original.designs[0]]);
    expect(result.recoveryRaw).toBe(raw);
    expect(result.error).toMatch(/original data is kept/);
    expect(result.unavailable).toBe(false);
    expect(stored.values.get(SAVED_DESIGNS_KEY)).toBe(raw);
    expect(stored.setItem).not.toHaveBeenCalled();
    persistSavedDesigns(result.library, result.recoveryRaw, stored);
    expect(stored.setItem.mock.calls[0][0]).toMatch(new RegExp(`^${DESIGN_RECOVERY_PREFIX}`));
    expect(stored.setItem.mock.calls[0][1]).toBe(raw);
    expect(readSavedDesigns(stored).error).toBeNull();
  });

  it('backs up a damaged partnership without silently reopening that design as independent trains', () => {
    const original = library();
    const working = createLayout('coupling-demo');
    const damaged = { id: 'bad-coupling', name: 'Damaged pair', updatedAt: timestamp,
      layout: { ...working, couplings: [{ id: 'pair', e6Id: working.trains![0].id, e5Id: 'missing-partner' }] } };
    const raw = JSON.stringify({ version: 1, designs: [original.designs[0], damaged] });
    const stored = storage({ [SAVED_DESIGNS_KEY]: raw });
    const recovered = readSavedDesigns(stored);
    expect(recovered.library.designs).toEqual([original.designs[0]]);
    expect(recovered.recoveryRaw).toBe(raw);
    expect(recovered.error).toMatch(/original data is kept/);
    expect(stored.setItem).not.toHaveBeenCalled();
    persistSavedDesigns(recovered.library, recovered.recoveryRaw, stored);
    expect(stored.setItem.mock.calls[0][1]).toBe(raw);
    expect(stored.setItem.mock.calls[0][0]).toContain(DESIGN_RECOVERY_PREFIX);
  });

  it.each(['{ invalid JSON', JSON.stringify({ version: 2, designs: [] }), 'null'])('retains unreadable library data for recovery: %s', (raw) => {
    const stored = storage({ [SAVED_DESIGNS_KEY]: raw });
    const result = readSavedDesigns(stored);
    expect(result.library).toEqual(empty());
    expect(result.recoveryRaw).toBe(raw);
    expect(result.error).not.toBeNull();
    expect(stored.setItem).not.toHaveBeenCalled();
  });

  it('marks unavailable storage explicitly instead of presenting it as an ordinary empty library', () => {
    const stored = storage();
    stored.getItem.mockImplementation(() => { throw new Error('Denied'); });
    const result = readSavedDesigns(stored);
    expect(result.unavailable).toBe(true);
    expect(result.error).toMatch(/could not be read/);
    expect(stored.setItem).not.toHaveBeenCalled();
  });

  it('fails truthfully on quota errors without changing stored snapshots or its input library', () => {
    const original = library();
    const raw = JSON.stringify(original);
    const stored = storage({ [SAVED_DESIGNS_KEY]: raw });
    stored.setItem.mockImplementation(() => { throw new Error('Quota exceeded'); });
    const result = saveDesignSnapshot(original, createLayout('empty'), 'New idea', null, false,
      { id: 'new-design', updatedAt: timestamp });
    expect(() => persistSavedDesigns(result.library, null, stored)).toThrow(/could not be updated/);
    expect(stored.values.get(SAVED_DESIGNS_KEY)).toBe(raw);
    expect(original.designs).toHaveLength(2);
    expect(readSavedDesigns(stored).library).toEqual(original);
  });

  it('never overwrites damaged data if its recovery backup cannot be stored', () => {
    const raw = '{ damaged library';
    const stored = storage({ [SAVED_DESIGNS_KEY]: raw });
    stored.setItem.mockImplementation(() => { throw new Error('Quota exceeded'); });
    expect(() => persistSavedDesigns(library(), raw, stored)).toThrow(/could not be updated/);
    expect(stored.setItem).toHaveBeenCalledTimes(1);
    expect(stored.setItem.mock.calls[0][0]).toContain(DESIGN_RECOVERY_PREFIX);
    expect(stored.values.get(SAVED_DESIGNS_KEY)).toBe(raw);
  });

  it('keeps both the original and recovery backup if replacing the library fails after backup', () => {
    const raw = '{ damaged library';
    const stored = storage({ [SAVED_DESIGNS_KEY]: raw });
    stored.setItem.mockImplementation((key, value) => {
      if (key === SAVED_DESIGNS_KEY) throw new Error('Quota exceeded');
      stored.values.set(key, value);
    });
    expect(() => persistSavedDesigns(library(), raw, stored)).toThrow();
    expect(stored.values.get(SAVED_DESIGNS_KEY)).toBe(raw);
    expect([...stored.values.entries()].filter(([key]) => key.startsWith(DESIGN_RECOVERY_PREFIX))).toHaveLength(1);
    expect(stored.setItem.mock.calls[0][1]).toBe(raw);
  });

  it('strips unsupported fields and validates each restored snapshot', () => {
    const original = library();
    const raw = JSON.stringify({ version: 1, designs: [
      { ...original.designs[0], extra: 'ignored', layout: { ...original.designs[0].layout, injected: true } },
      { ...original.designs[1], id: 'bad', updatedAt: 'not a timestamp' },
    ] });
    const result = readSavedDesigns(storage({ [SAVED_DESIGNS_KEY]: raw }));
    expect(result.library.designs).toEqual([original.designs[0]]);
    expect(result.recoveryRaw).toBe(raw);
  });
});

describe('working saved-design identity', () => {
  it('migrates the active saved ID with the same newest-valid-layout precedence', () => {
    const original = library();
    const previous = { ...createLayout('compact'), savedDesignId: 'design-a' };
    const stored = storage({ [PREVIOUS_STORAGE_KEY]: JSON.stringify(previous) });
    expect(readWorkingDesignId(original, stored)).toBe('design-a');
    stored.values.set(STORAGE_KEY, JSON.stringify(createLayout('city')));
    expect(readWorkingDesignId(original, stored)).toBeNull();
    stored.values.set(STORAGE_KEY, '{ damaged new save');
    expect(readWorkingDesignId(original, stored)).toBe('design-a');
    expect(stored.setItem).not.toHaveBeenCalled();
  });

  it('keeps a v2 saved-design identity available after v3, v4 and v5 storage are introduced', () => {
    const original = library();
    const previous = { ...createLayout('compact'), savedDesignId: 'design-a' };
    const stored = storage({ [V2_STORAGE_KEY]: JSON.stringify(previous), [V3_STORAGE_KEY]: '{ damaged v3',
      [PREVIOUS_STORAGE_KEY]: '{ damaged v4', [STORAGE_KEY]: '{ damaged v5' });
    expect(readWorkingDesignId(original, stored)).toBe('design-a');
    expect(stored.setItem).not.toHaveBeenCalled();
    expect(stored.values.get(V2_STORAGE_KEY)).toBe(JSON.stringify(previous));
  });

  it('recovers a v3 design identity when v5 and v4 working saves are damaged without writing to earlier keys', () => {
    const original = library();
    const previous = { ...snapshotFleetLayout(createLayout('compact'), restoreFleet(createLayout('compact')), 'train-1'),
      version: 3, savedDesignId: 'design-b' };
    const raw = JSON.stringify(previous);
    const stored = storage({ [V3_STORAGE_KEY]: raw, [PREVIOUS_STORAGE_KEY]: '{ damaged v4', [STORAGE_KEY]: '{ damaged v5' });
    expect(readWorkingDesignId(original, stored)).toBe('design-b');
    expect(stored.setItem).not.toHaveBeenCalled();
    expect(stored.values.get(V3_STORAGE_KEY)).toBe(raw);
  });

  it('retains stable partnerships in separate named designs and independent save-as copies', () => {
    const working = createLayout('coupling-demo');
    const fleet = restoreFleet(working);
    const relation = { id: 'nose-pair', e6Id: fleet[0].id, e5Id: fleet[1].id };
    const coupled = snapshotFleetLayout(working, fleet, fleet[1].id, [relation]);
    const first = saveDesignSnapshot(empty(), coupled, 'Joined trains', null, false, { id: 'joined', updatedAt: timestamp });
    const second = saveDesignSnapshot(first.library, working, 'Separate trains', null, false, { id: 'separate', updatedAt: timestamp });
    const copied = saveDesignSnapshot(second.library, coupled, 'Joined copy', 'joined', true, { id: 'copy', updatedAt: timestamp });
    const stored = storage();
    persistSavedDesigns(copied.library, null, stored);
    const opened = readSavedDesigns(stored);
    expect(opened.error).toBeNull();
    expect(opened.library.version).toBe(1);
    expect(opened.library.designs.map(design => design.layout.couplings)).toEqual([[relation], [], [relation]]);
    expect(opened.library.designs[0].layout.selectedTrainId).toBe(fleet[1].id);
    expect(restoreFleet(opened.library.designs[0].layout).every(train => train.actualSpeed === 0 && !train.running)).toBe(true);
    opened.library.designs[2].layout.couplings![0].id = 'changed';
    expect(opened.library.designs[0].layout.couplings![0].id).toBe('nose-pair');
    expect(first.library.designs[0].layout.couplings![0].id).toBe('nose-pair');
  });

  it('retains old E6/E5 designs beside new same-model and reversed-cab Shinkansen copies in the existing library', () => {
    const working = createLayout('coupling-demo');
    const oldRelation = { id: 'old-pair', e6Id: working.trains![0].id, e5Id: working.trains![1].id };
    const oldLayout = { ...working, version: 4 as const, couplings: [oldRelation] };
    const first = saveDesignSnapshot(empty(), oldLayout, 'Original E6 plus E5', null, false,
      { id: 'old-design', updatedAt: timestamp });
    const firstJson = JSON.stringify(first.library);
    const newFleet = restoreFleet(working).map((train, index) => ({ ...train, type: 'e7' as const,
      carCount: index === 0 ? 11 : 7, cabForward: index === 0,
    }));
    const newRelation = { ...oldRelation, id: 'new-pair', e6End: 'front' as const, e5End: 'front' as const };
    const newLayout = snapshotFleetLayout(working, newFleet, newFleet[1].id, [newRelation]);
    const copied = saveDesignSnapshot(first.library, newLayout, 'Two E7 trains', 'old-design', true,
      { id: 'new-design', updatedAt: timestamp });
    const stored = storage();
    persistSavedDesigns(copied.library, null, stored);
    const reopened = readSavedDesigns(stored);
    expect(reopened.error).toBeNull();
    expect(reopened.library.version).toBe(1);
    expect(reopened.library.designs.map(design => design.layout.version)).toEqual([4, 5]);
    expect(reopened.library.designs[0].layout.couplings).toEqual([oldRelation]);
    expect(reopened.library.designs[1].layout.couplings).toEqual([newRelation]);
    expect(reopened.library.designs[1].layout.trains!.map(train => train.carCount)).toEqual([11, 7]);
    expect(restoreFleet(reopened.library.designs[1].layout).every(train => !train.running && train.actualSpeed === 0)).toBe(true);
    reopened.library.designs[1].layout.couplings![0].e6End = 'rear';
    expect(copied.library.designs[1].layout.couplings![0].e6End).toBe('front');
    expect(JSON.stringify(first.library)).toBe(firstJson);
  });

  it('preserves a damaged new cab-end save for recovery instead of changing its connection', () => {
    const working = createLayout('coupling-demo');
    const original = library();
    const damaged = { id: 'bad-end', name: 'Unrecognized cab end', updatedAt: timestamp,
      layout: { ...working, version: 5, couplings: [{ id: 'pair', e6Id: working.trains![0].id,
        e5Id: working.trains![1].id, e6End: 'head', e5End: 'front' }] } };
    const raw = JSON.stringify({ version: 1, designs: [original.designs[0], damaged] });
    const stored = storage({ [SAVED_DESIGNS_KEY]: raw });
    const read = readSavedDesigns(stored);
    expect(read.library.designs).toEqual([original.designs[0]]);
    expect(read.recoveryRaw).toBe(raw);
    expect(read.error).toMatch(/original data is kept/);
    expect(stored.setItem).not.toHaveBeenCalled();
    persistSavedDesigns(read.library, read.recoveryRaw, stored);
    expect(stored.setItem.mock.calls[0][0]).toContain(DESIGN_RECOVERY_PREFIX);
    expect(stored.setItem.mock.calls[0][1]).toBe(raw);
  });

  it('keeps each named fleet snapshot independent with selection and stopped restoration', () => {
    const working = createLayout('city');
    const first = restoreFleet(working)[0];
    const trains = [first, { ...first, id: 'train-2', name: 'Second E5', type: 'e5' as const, requestedSpeed: 100, cabForward: false, position: null }];
    const snapshot = snapshotFleetLayout(working, trains, 'train-2');
    const saved = saveDesignSnapshot(empty(), snapshot, 'Two railways', null, false, { id: 'fleet-design', updatedAt: timestamp });
    const stored = storage();
    persistSavedDesigns(saved.library, null, stored);
    trains[0].position!.distance += 100;
    trains[1].requestedSpeed = 15;
    const opened = readSavedDesigns(stored).library.designs[0].layout;
    expect(opened.selectedTrainId).toBe('train-2');
    expect(opened.trains![0].position!.distance).not.toBe(trains[0].position!.distance);
    expect(opened.trains![1].requestedSpeed).toBe(100);
    expect(restoreFleet(opened).every(train => !train.running && train.actualSpeed === 0)).toBe(true);
    expect(opened.trains![1].cabForward).toBe(false);
    const copied = saveDesignSnapshot(saved.library, opened, 'Copied fleet', 'fleet-design', true, { id: 'fleet-copy', updatedAt: timestamp });
    expect(copied.library.designs).toHaveLength(2);
    expect(copied.library.designs[0].layout).toEqual(opened);
    copied.design.layout.trains![0].position!.distance += 5;
    expect(copied.library.designs[0].layout).toEqual(opened);
  });
  it('restores only an ID that exists in the library and accompanies a valid working layout', () => {
    const original = library();
    const stored = storage({ [STORAGE_KEY]: JSON.stringify({ ...createLayout('compact'), savedDesignId: 'design-a' }) });
    expect(readWorkingDesignId(original, stored)).toBe('design-a');
    stored.values.set(STORAGE_KEY, JSON.stringify({ ...createLayout('compact'), savedDesignId: 'deleted-id' }));
    expect(readWorkingDesignId(original, stored)).toBeNull();
    stored.values.set(STORAGE_KEY, JSON.stringify({ ...createLayout('compact'), savedDesignId: 'design-a', carCount: 2 }));
    expect(readWorkingDesignId(original, stored)).toBeNull();
  });

  it('treats ordinary autosaves, absent metadata, corruption, and unreadable storage as unassociated', () => {
    const original = library();
    for (const raw of [JSON.stringify(createLayout('compact')), '{ bad JSON', JSON.stringify({ savedDesignId: 'design-a' })]) {
      expect(readWorkingDesignId(original, storage({ [STORAGE_KEY]: raw }))).toBeNull();
    }
    const stored = storage();
    expect(readWorkingDesignId(original, stored)).toBeNull();
    stored.getItem.mockImplementation(() => { throw new Error('Denied'); });
    expect(readWorkingDesignId(original, stored)).toBeNull();
  });
});
