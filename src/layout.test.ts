import { afterEach, describe, expect, it, vi } from 'vitest'
import { KATO_CATALOG } from './catalog'
import { LEGACY_STORAGE_KEY, STORAGE_KEY, createLayout, loadLayout, parseLayout, type LayoutData, type PlacedAccessory } from './layout'
import { endpoints, makeStarterLayout, openEndpoints } from './track'

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
    expect(original.tracks.some((track) => track.elevation === 60)).toBe(true)
    expect(parseLayout(JSON.parse(JSON.stringify(original)))).toEqual(original)
  })

  it('normalizes display names and permits an empty railway', () => {
    const original = layout()
    expect(parseLayout({ ...original, name: '  Our railway  ' }).name).toBe('Our railway')
    expect(parseLayout({ ...original, name: '   ' }).name).toBe('My Railway')
    expect(parseLayout({ ...original, name: 'a'.repeat(100) }).name).toHaveLength(60)
    expect(parseLayout({ ...original, tracks: [], accessories: [] }).tracks).toEqual([])
  })

  it('retains a source drawing through saving and rejects unknown source markers', () => {
    const original = { ...layout(), sourcePlan: 'kato-plan02-1a' as const }
    expect(parseLayout(JSON.parse(JSON.stringify(original)))).toEqual(original)
    expect(parseLayout({ ...original, name: 'Our edited KATO railway' }).sourcePlan).toBe('kato-plan02-1a')
    for (const sourcePlan of ['other-plan', null, 12]) {
      expect(() => parseLayout({ ...original, sourcePlan })).toThrow(/source plan/)
    }
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
    { version: 2, name: 'Railway', tracks: [], accessories: [], carCount: 12 },
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

  it.each([3, 4, 5, 6, 7, 8, 9, 10, 11])('preserves the supported %i-car formation', (carCount) => {
    expect(parseLayout({ ...layout(), carCount }).carCount).toBe(carCount)
  })

  it.each([2, 12, 3.5, NaN, Infinity, '6', null, undefined])('rejects invalid train lengths: %j', (carCount) => {
    expect(() => parseLayout({ ...layout(), carCount })).toThrow('3 to 11')
  })
})

describe('persistent switch numbers', () => {
  const switches = () => {
    const original = layout()
    const turnout = KATO_CATALOG.find((item) => item.shape === 'turnout')!
    const scissors = KATO_CATALOG.find((item) => item.shape === 'scissors')!
    return [
      { ...original.tracks[0], id: 'turnout-1', kind: turnout.kind },
      { ...original.tracks[0], id: 'scissors-1', kind: scissors.kind },
      { ...original.tracks[0], id: 'turnout-2', kind: turnout.kind },
    ]
  }

  it.each([1, 2])('numbers unnumbered switches in version %i layouts in placement order', (version) => {
    const tracks = switches()
    const parsed = parseLayout({ ...layout(), version, tracks })
    expect(parsed.tracks.map((track) => track.switchNumber)).toEqual([1, 2, 3])
    expect(tracks.every((track) => track.switchNumber === undefined)).toBe(true)
  })

  it('reserves saved numbers before assigning missing numbers after the highest label', () => {
    const tracks = switches()
    const parsed = parseLayout({ ...layout(), tracks: [tracks[0], { ...tracks[1], switchNumber: 8 }, tracks[2]] })
    expect(parsed.tracks.map((track) => track.switchNumber)).toEqual([9, 8, 10])
    expect(parseLayout(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed)
  })

  it('keeps existing labels and gaps when earlier switches are deleted or reordered', () => {
    const tracks = switches().map((track, index) => ({ ...track, switchNumber: index + 1 }))
    const parsed = parseLayout({ ...layout(), tracks: [tracks[2], tracks[0]] })
    expect(parsed.tracks.map((track) => track.switchNumber)).toEqual([3, 1])
    expect(parseLayout({ ...parsed, tracks: [...parsed.tracks, { ...tracks[1], switchNumber: undefined }] })
      .tracks.map((track) => track.switchNumber)).toEqual([3, 1, 4])
  })

  it.each([0, -1, 1.5, NaN, Infinity, '1', null, Number.MAX_SAFE_INTEGER + 1])('rejects invalid switch labels: %j', (switchNumber) => {
    expect(() => parseLayout({ ...layout(), tracks: [{ ...switches()[0], switchNumber }] })).toThrow('switch number')
  })

  it('rejects repeated switch labels without conflating distinct track ids', () => {
    expect(() => parseLayout({ ...layout(), tracks: switches().map((track) => ({ ...track, switchNumber: 4 })) }))
      .toThrow('duplicate switch number')
  })

  it('rejects switch numbers on ordinary track instead of reserving invisible controls', () => {
    const original = layout()
    expect(() => parseLayout({ ...original, tracks: [{ ...original.tracks[0], switchNumber: 1 }] }))
      .toThrow('switch number')
  })

  it('loads existing autosaves while persisting the full integer train length and switch labels', () => {
    const tracks = switches()
    const saved = { ...layout(), carCount: 8, tracks: [{ ...tracks[0], switchNumber: 5 }, tracks[1]] }
    vi.stubGlobal('localStorage', { getItem: (key: string) => key === STORAGE_KEY ? JSON.stringify(saved) : null })
    const recovered = loadLayout()
    expect(recovered.carCount).toBe(8)
    expect(recovered.tracks.map((track) => track.switchNumber)).toEqual([5, 6])
    expect(parseLayout(JSON.parse(JSON.stringify(recovered)))).toEqual(recovered)
  })
})

describe('documented viaduct supports', () => {
  it('places one catalog support at each elevated joint and preserves it through export', () => {
    const original = createLayout('viaduct')
    const support = KATO_CATALOG.find((item) => item.kind === 'a-pier-tapered')!
    expect(support.sku).toBe('23-069')
    expect(support.supportDeckHeight).toBe(60)
    const piers = original.accessories.filter((item) => item.kind === support.kind)
    const elevatedTracks = original.tracks.filter((track) => track.elevation === 60)
    expect(piers).toHaveLength(elevatedTracks.length)
    expect(piers.every((pier) => pier.elevation === 0)).toBe(true)
    for (const track of elevatedTracks) for (const endpoint of endpoints(track)) {
      expect(piers.filter((pier) => Math.hypot(pier.x - endpoint.position.x, pier.y - endpoint.position.y) <= .25)).toHaveLength(1)
    }
    expect(parseLayout(JSON.parse(JSON.stringify(original)))).toEqual(original)
  })

  it('keeps the ground underpass inside a bridge span rather than on a supported joint', () => {
    const original = createLayout('viaduct')
    const groundTrack = original.tracks.find((track) => track.id.startsWith('ground-'))!
    expect(groundTrack.elevation).toBe(0)
    expect(groundTrack.x).toBe(124)
    const piers = original.accessories.filter((item) => KATO_CATALOG.find((spec) => spec.kind === item.kind)?.accessoryType === 'pier')
    expect(piers.every((pier) => Math.abs(pier.x - groundTrack.x) > 30)).toBe(true)
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
