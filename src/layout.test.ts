import { afterEach, describe, expect, it, vi } from 'vitest'
import { KATO_CATALOG } from './catalog'
import { LEGACY_STORAGE_KEY, STORAGE_KEY, createLayout, loadLayout, parseLayout, type LayoutData, type PlacedAccessory } from './layout'
import { makeStarterLayout, openEndpoints } from './track'

const layout = (): LayoutData => createLayout('compact')
const accessory = (): PlacedAccessory => ({
  id: 'station-1',
  kind: KATO_CATALOG.find((item) => item.category === 'accessory')!.kind,
  x: 0, y: 100, angle: 0, elevation: 0,
})
const legacy = () => ({
  version: 1,
  name: 'Our original railway',
  tracks: makeStarterLayout('oval').map(({ id, kind, x, y, angle, bend }) => ({ id, kind, x, y, angle, bend })),
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('layout file validation', () => {
  it('round-trips a 3D railway with scenery, elevated track, and train settings', () => {
    const original = createLayout('viaduct')
    expect(original.accessories.length).toBeGreaterThan(0)
    expect(original.tracks.some((track) => track.elevation === 80)).toBe(true)
    expect(parseLayout(JSON.parse(JSON.stringify(original)))).toEqual(original)
  })

  it('normalizes display names and permits an empty railway', () => {
    const original = layout()
    expect(parseLayout({ ...original, name: '  Our railway  ' }).name).toBe('Our railway')
    expect(parseLayout({ ...original, name: '   ' }).name).toBe('My Railway')
    expect(parseLayout({ ...original, name: 'a'.repeat(100) }).name).toHaveLength(60)
    expect(parseLayout({ ...original, tracks: [], accessories: [] }).tracks).toEqual([])
  })

  it('migrates the original 2D format without losing the railway', () => {
    const original = legacy()
    const migrated = parseLayout(original)
    expect(migrated).toEqual({
      version: 2, name: original.name,
      tracks: original.tracks.map((track) => ({ ...track, elevation: 0, endElevation: 0 })),
      accessories: [], carCount: 11,
    })
    expect(openEndpoints(migrated.tracks)).toHaveLength(0)
  })

  it('defaults missing track heights and retains the start height at the end', () => {
    const original = layout()
    const { elevation: _elevation, endElevation: _endElevation, ...flat } = original.tracks[0]
    expect(parseLayout({ ...original, tracks: [flat] }).tracks[0]).toMatchObject({ elevation: 0, endElevation: 0 })
    expect(parseLayout({ ...original, tracks: [{ ...flat, elevation: 80 }] }).tracks[0])
      .toMatchObject({ elevation: 80, endElevation: 80 })
  })

  it('removes untrusted extra fields rather than copying arbitrary imported objects', () => {
    const original = layout()
    const parsed = parseLayout({
      ...original, extra: 'ignored',
      tracks: [{ ...original.tracks[0], password: 'not part of a railway', injected: { arbitrary: true } }],
      accessories: [{ ...accessory(), extra: 'ignored' }],
    })
    expect(parsed).not.toHaveProperty('extra')
    expect(parsed.tracks[0]).not.toHaveProperty('password')
    expect(parsed.tracks[0]).not.toHaveProperty('injected')
    expect(parsed.accessories[0]).not.toHaveProperty('extra')
  })

  it.each([
    null, false, 'a railway', [],
    { version: 3, name: 'Unsupported railway', tracks: [] },
    { version: 1, name: 42, tracks: [] },
    { version: 1, name: 'Railway', tracks: {} },
    { version: 2, name: 'Railway', tracks: [], accessories: {} },
    { version: 2, name: 'Railway', tracks: [], accessories: [], carCount: 4 },
  ])('rejects unsupported layout data: %j', (value) => {
    expect(() => parseLayout(value)).toThrow()
  })

  it.each([
    { kind: 'unknown' }, { id: null }, { id: '' }, { id: '   ' }, { id: 'x'.repeat(101) },
    { x: NaN }, { y: Infinity }, { angle: -Infinity }, { x: '10' }, { y: 50_001 },
    { angle: 1001 }, { bend: 0 }, { elevation: -1 }, { elevation: 501 }, { elevation: null },
    { endElevation: Infinity }, { endElevation: '80' }, { switchState: 'left' },
    { route: 1 }, { route: -1 }, { route: 0.5 }, { route: '0' },
  ])('rejects unsafe or unsupported track values: %j', (invalid) => {
    const valid = layout()
    expect(() => parseLayout({ ...valid, tracks: [{ ...valid.tracks[0], ...invalid }] })).toThrow()
  })

  it('accepts supported switch and lane routes and rejects nonexistent routes', () => {
    const original = layout()
    const turnout = KATO_CATALOG.find((item) => item.shape === 'turnout')!
    const scissors = KATO_CATALOG.find((item) => item.shape === 'scissors')!
    const switches = [
      { ...original.tracks[0], kind: turnout.kind, switchState: 'branch', route: 1 },
      { ...original.tracks[0], id: 'scissors-1', kind: scissors.kind, switchState: 'straight', route: 3 },
    ]
    expect(parseLayout({ ...original, tracks: switches }).tracks).toMatchObject(switches)
    expect(() => parseLayout({ ...original, tracks: [{ ...switches[0], route: 2 }] })).toThrow()
    expect(() => parseLayout({ ...original, tracks: [{ ...switches[1], route: 4 }] })).toThrow()
  })

  it.each([
    { kind: 'unknown' }, { kind: 's248' }, { id: '' }, { x: NaN }, { y: 50_001 },
    { angle: 1001 }, { elevation: -1 }, { elevation: 501 }, { elevation: null },
  ])('rejects invalid accessories: %j', (invalid) => {
    expect(() => parseLayout({ ...layout(), accessories: [{ ...accessory(), ...invalid }] })).toThrow()
  })

  it('prevents scenery from being imported as runnable track', () => {
    const valid = layout()
    expect(() => parseLayout({ ...valid, tracks: [{ ...valid.tracks[0], kind: accessory().kind }] })).toThrow()
  })

  it('rejects duplicate ids within tracks and across scenery and tracks', () => {
    const valid = layout()
    const duplicate = { ...valid.tracks[1], id: valid.tracks[0].id }
    expect(() => parseLayout({ ...valid, tracks: [valid.tracks[0], duplicate] })).toThrow()
    expect(() => parseLayout({ ...valid, accessories: [{ ...accessory(), id: valid.tracks[0].id }] })).toThrow()
    expect(() => parseLayout({ ...valid, accessories: [accessory(), accessory()] })).toThrow()
  })

  it('limits the combined number of tracks and accessories to 300', () => {
    const valid = layout()
    const tracks = Array.from({ length: 299 }, (_, index) => ({ ...valid.tracks[0], id: `piece-${index}` }))
    expect(parseLayout({ ...valid, tracks, accessories: [accessory()] }).tracks).toHaveLength(299)
    expect(() => parseLayout({ ...valid, tracks, accessories: [accessory(), { ...accessory(), id: 'station-2' }] })).toThrow('300')
  })

  it.each([3, 6, 11] as const)('preserves the supported %i-car formation', (carCount) => {
    expect(parseLayout({ ...layout(), carCount }).carCount).toBe(carCount)
  })
})

describe('saved layout recovery', () => {
  it('loads the current save before considering the original save', () => {
    const valid = layout()
    const getItem = vi.fn((key: string) => key === STORAGE_KEY ? JSON.stringify(valid) : JSON.stringify(legacy()))
    vi.stubGlobal('localStorage', { getItem })
    expect(loadLayout()).toEqual(valid)
    expect(getItem).toHaveBeenCalledExactlyOnceWith(STORAGE_KEY)
  })

  it('recovers the original 2D save when there is no current save', () => {
    const original = legacy()
    const getItem = vi.fn((key: string) => key === LEGACY_STORAGE_KEY ? JSON.stringify(original) : null)
    vi.stubGlobal('localStorage', { getItem })
    expect(loadLayout()).toEqual(parseLayout(original))
    expect(getItem).toHaveBeenCalledWith(STORAGE_KEY)
    expect(getItem).toHaveBeenCalledWith(LEGACY_STORAGE_KEY)
  })

  it('recovers the original save even if a newer save is corrupted', () => {
    const original = legacy()
    vi.stubGlobal('localStorage', { getItem: (key: string) => key === STORAGE_KEY ? '{ broken JSON' : JSON.stringify(original) })
    expect(loadLayout()).toEqual(parseLayout(original))
  })

  it.each([
    null,
    '{ this is not JSON',
    JSON.stringify({ version: 3, name: 'Unsupported', tracks: [] }),
    JSON.stringify({ version: 1, name: 'Corrupt', tracks: [{ kind: 'unknown' }] }),
  ])('recovers safely from absent or corrupt saves: %j', (saved) => {
    vi.stubGlobal('localStorage', { getItem: () => saved })
    const recovered = loadLayout()
    expect(recovered).toEqual(createLayout('city'))
    expect(recovered.name).toBe('Tokyo Railway')
    expect(openEndpoints(recovered.tracks)).toHaveLength(0)
  })

  it('still opens a playable city when browser storage is unavailable', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('Storage is unavailable') } })
    expect(loadLayout()).toEqual(createLayout('city'))
    vi.stubGlobal('localStorage', undefined)
    expect(loadLayout()).toEqual(createLayout('city'))
  })
})
