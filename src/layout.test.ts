import { afterEach, describe, expect, it, vi } from 'vitest'
import { KATO_CATALOG } from './catalog'
import { LEGACY_STORAGE_KEY, PREVIOUS_STORAGE_KEY, STORAGE_KEY, V3_STORAGE_KEY, V2_STORAGE_KEY, createLayout, loadLayout, parseLayout, type LayoutData, type PlacedAccessory } from './layout'
import { endpoints, makeStarterLayout, openEndpoints } from './track'
import { getTrainSpec, TRAIN_TYPES } from './trains'
import { MAX_TRAINSETS, restoreFleet, snapshotFleetLayout } from './fleet'
import { MAX_STATION_NAME_LENGTH } from './stationName'

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

  it('retains custom Japanese and bilingual platform and station names in a version 5 export', () => {
    const starter = createLayout('city')
    const current = snapshotFleetLayout(starter, restoreFleet(starter), 'train-1')
    const original = { ...current, accessories: current.accessories.map((item) => ({
      ...item,
      ...(item.kind === 'a-platform' ? { stationName: '品川 Shinagawa' }
        : item.kind === 'a-station' ? { stationName: '新宿' } : {}),
    })) }
    const restored = parseLayout(JSON.parse(JSON.stringify(original)))
    expect(restored).toEqual(original)
    expect(restored.version).toBe(5)
    expect(restored.accessories.find((item) => item.kind === 'a-platform')?.stationName).toBe('品川 Shinagawa')
    expect(restored.accessories.find((item) => item.kind === 'a-station')?.stationName).toBe('新宿')
  })

  it('normalizes custom names without changing older accessories or storing blank defaults', () => {
    const original = createLayout('city')
    expect(parseLayout(original)).toEqual(original)
    expect(original.accessories.every((item) => !Object.hasOwn(item, 'stationName'))).toBe(true)
    const parsed = parseLayout({ ...original, accessories: [
      { ...original.accessories[0], stationName: '  横浜\n\tYokohama　中央  ' },
      { ...original.accessories[1], stationName: ' \n　 ' },
      { ...original.accessories[2], stationName: '  ' },
    ] })
    expect(parsed.accessories[0].stationName).toBe('横浜 Yokohama 中央')
    expect(parsed.accessories[1]).not.toHaveProperty('stationName')
    expect(parsed.accessories[2]).not.toHaveProperty('stationName')
    expect(original.accessories[0]).not.toHaveProperty('stationName')
  })

  it('accepts the station name limit after normalizing whitespace and rejects names beyond it', () => {
    const original = createLayout('city')
    const platform = original.accessories[0]
    const accepted = '駅'.repeat(MAX_STATION_NAME_LENGTH)
    expect(parseLayout({ ...original, accessories: [{ ...platform, stationName: `  ${accepted}  ` }] })
      .accessories[0].stationName).toBe(accepted)
    for (const stationName of ['駅'.repeat(MAX_STATION_NAME_LENGTH + 1), '🚉'.repeat(31)]) {
      expect(() => parseLayout({ ...original, accessories: [{ ...platform, stationName }] }))
        .toThrow(/station name.*60 characters/)
    }
  })

  it.each([null, 42, true, {}, ['Tokyo']])('rejects malformed imported station names: %j', (stationName) => {
    const original = createLayout('city')
    expect(() => parseLayout({ ...original, accessories: [{ ...original.accessories[0], stationName }] }))
      .toThrow(/station name.*text/)
  })

  it('rejects nonblank names on accessories that cannot display station signs', () => {
    const original = createLayout('city')
    for (const item of KATO_CATALOG.filter((item) => item.category === 'accessory'
      && item.accessoryType !== 'platform' && item.accessoryType !== 'station')) {
      expect(() => parseLayout({ ...original, accessories: [{ ...accessory(), kind: item.kind, stationName: '新宿' }] }))
        .toThrow(/station name.*platform or station/)
    }
  })

  it('restores custom station names from the existing autosave key without rewriting storage', () => {
    const original = createLayout('city')
    const saved = snapshotFleetLayout({ ...original,
      accessories: original.accessories.map((item) => item.kind === 'a-platform' ? { ...item, stationName: '京都 Kyoto' } : item),
    }, restoreFleet(original), 'train-1')
    const raw = JSON.stringify(saved)
    const storage = { getItem: vi.fn((key: string) => key === STORAGE_KEY ? raw : null), setItem: vi.fn() }
    vi.stubGlobal('localStorage', storage)
    expect(loadLayout()).toEqual(saved)
    expect(storage.setItem).not.toHaveBeenCalled()
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

  it.each(TRAIN_TYPES)('retains the selected %s train through a layout file round trip', (trainType) => {
    const original = { ...createLayout('viaduct'), carCount: 5, trainType }
    expect(parseLayout(JSON.parse(JSON.stringify(original)))).toEqual(original)
  })

  it('keeps train type absent on older layouts so they continue to default to E235', () => {
    expect(parseLayout(layout())).not.toHaveProperty('trainType')
    expect(parseLayout(legacy())).not.toHaveProperty('trainType')
  })

  it.each(['e8', 'E5', '', null, 5, {}, ['e5']])('rejects an unrecognized train type: %j', (trainType) => {
    expect(() => parseLayout({ ...layout(), trainType })).toThrow('unrecognized train')
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
  it('reads a previous 3D autosave without modifying it and prefers a valid v5 snapshot', () => {
    const original = { ...createLayout('compact'), trainType: 'e7' as const, carCount: 5 }
    const fleetLayout = snapshotFleetLayout(original, restoreFleet(original), 'train-1')
    const values = new Map([[PREVIOUS_STORAGE_KEY, JSON.stringify(original)]])
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem })
    expect(loadLayout()).toEqual(original)
    values.set(STORAGE_KEY, JSON.stringify(fleetLayout))
    expect(loadLayout()).toEqual(fleetLayout)
    expect(setItem).not.toHaveBeenCalled()
    values.set(STORAGE_KEY, '{ damaged fleet')
    expect(loadLayout()).toEqual(original)
  })

  it('tries v5, v4, v3, v2 and v1 in order without replacing any original autosave', () => {
    const original = createLayout('compact')
    const oldFleet = { ...snapshotFleetLayout(original, restoreFleet(original), 'train-1'), version: 3 }
    const oldCouplingFleet = { ...snapshotFleetLayout(original, restoreFleet(original), 'train-1'), version: 4, name: 'Previous draft' }
    const latest = { ...snapshotFleetLayout(original, restoreFleet(original), 'train-1'), name: 'Latest draft' }
    const values = new Map([[LEGACY_STORAGE_KEY, JSON.stringify(legacy())], [V2_STORAGE_KEY, JSON.stringify(original)]])
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem })
    expect(loadLayout()).toEqual(original)
    values.set(V3_STORAGE_KEY, JSON.stringify(oldFleet))
    expect(loadLayout()).toEqual(parseLayout(oldFleet))
    values.set(PREVIOUS_STORAGE_KEY, JSON.stringify(oldCouplingFleet))
    expect(loadLayout()).toEqual(parseLayout(oldCouplingFleet))
    values.set(STORAGE_KEY, JSON.stringify(latest))
    expect(loadLayout()).toEqual(latest)
    values.set(STORAGE_KEY, '{ damaged v5')
    expect(loadLayout()).toEqual(parseLayout(oldCouplingFleet))
    values.set(PREVIOUS_STORAGE_KEY, '{ damaged v4')
    expect(loadLayout()).toEqual(parseLayout(oldFleet))
    values.set(V3_STORAGE_KEY, '{ damaged v3')
    expect(loadLayout()).toEqual(original)
    values.set(V2_STORAGE_KEY, '{ damaged v2')
    expect(loadLayout()).toEqual(parseLayout(legacy()))
    expect(setItem).not.toHaveBeenCalled()
  })
  it('restores the selected Shinkansen from the working autosave', () => {
    const original = { ...createLayout('compact'), trainType: 'e6' as const, carCount: 7 }
    vi.stubGlobal('localStorage', { getItem: (key: string) => key === STORAGE_KEY ? JSON.stringify(original) : null })
    expect(loadLayout()).toEqual(original)
  })

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

describe('version 3 independent train validation', () => {
  const fleetLayout = () => {
    const original = createLayout('city')
    const first = restoreFleet(original)[0]
    const { couplings: _couplings, ...snapshot } = snapshotFleetLayout(original, [first,
      { ...first, id: 'train-2', name: 'Komachi 2', type: 'e6', carCount: 7, cabForward: false, requestedSpeed: 45, position: null }], 'train-2')
    return { ...snapshot, version: 3 as const }
  }

  it('round trips a mixed fleet with selection, speed, orientation and unplaced sets as deep copies', () => {
    const original = fleetLayout()
    const parsed = parseLayout(JSON.parse(JSON.stringify(original)))
    expect(parsed).toEqual(original)
    expect(parsed.trains).not.toBe(original.trains)
    expect(parsed.trains![0].position).not.toBe(original.trains![0].position)
    parsed.trains![0].position!.distance += 1
    expect(original.trains![0].position!.distance).not.toBe(parsed.trains![0].position!.distance)
    expect(parsed.trains![1]).toMatchObject({ type: 'e6', carCount: 7, requestedSpeed: 45, cabForward: false, position: null })
  })

  it('supports zero trains and multiple instances of each supported model', () => {
    const empty = snapshotFleetLayout(createLayout('empty'), [], null)
    expect(parseLayout(empty).trains).toEqual([])
    const original = fleetLayout()
    const trains = TRAIN_TYPES.flatMap((type, index) => [
      { ...original.trains![0], id: `a-${index}`, type }, { ...original.trains![1], id: `b-${index}`, type },
    ])
    expect(parseLayout({ ...original, trains, selectedTrainId: 'b-3' }).trains).toEqual(trains)
  })

  it('does not reinterpret legacy fields as a fleet before an explicit runtime migration', () => {
    const old = createLayout('compact')
    expect(parseLayout({ ...old, trains: [], selectedTrainId: 'unknown' })).toEqual(old)
  })

  it.each(TRAIN_TYPES)('saves and restores the full %s service-speed range', type => {
    const original = fleetLayout()
    const max = getTrainSpec(type).maxServiceSpeed
    const trains = [{ ...original.trains![0], type, requestedSpeed: max }, original.trains![1]]
    const saved = snapshotFleetLayout(original, trains, trains[0].id)
    const parsed = parseLayout(JSON.parse(JSON.stringify(saved)))
    expect(parsed.trains![0].requestedSpeed).toBe(max)
    expect(restoreFleet(parsed)[0]).toMatchObject({ requestedSpeed: max, actualSpeed: 0, running: false })
    expect(parsed.tracks).toEqual(original.tracks)
    expect(parsed.accessories).toEqual(original.accessories)
    expect(parsed.trains![1]).toEqual(original.trains![1])
  })

  it('migrates the former 120 km/h Yamanote setting without losing its design or other train settings', () => {
    const original = fleetLayout()
    const old = { ...original, trains: [
      { ...original.trains![0], requestedSpeed: 120 },
      { ...original.trains![1], requestedSpeed: 320 },
    ] }
    const parsed = parseLayout(JSON.parse(JSON.stringify(old)))
    expect(parsed).toEqual({ ...old, trains: [{ ...old.trains[0], requestedSpeed: 90 }, old.trains[1]] })
    expect(old.trains[0].requestedSpeed).toBe(120)
    vi.stubGlobal('localStorage', { getItem: (key: string) => key === STORAGE_KEY ? JSON.stringify(old) : null })
    expect(loadLayout()).toEqual(parsed)
  })

  it('retains zero and safely limits imported speeds to each model instead of dropping a valid design', () => {
    const original = fleetLayout()
    const trains = TRAIN_TYPES.map((type, index) => ({ ...original.trains![0], id: `speed-${index}`, type, requestedSpeed: 320 }))
    const parsed = parseLayout({ ...original, trains, selectedTrainId: trains[0].id })
    expect(parsed.trains!.map(train => train.requestedSpeed)).toEqual([90, 320, 320, 275])
    expect(parseLayout({ ...parsed, trains: parsed.trains!.map(train => ({ ...train, requestedSpeed: 0 })) })
      .trains!.every(train => train.requestedSpeed === 0)).toBe(true)
  })

  it.each([
    { id: '' }, { id: 'train-2' }, { name: ' ' }, { name: 'x'.repeat(61) },
    { type: 'E5' }, { type: 'e8' }, { carCount: 2 }, { carCount: 12 }, { carCount: 3.5 },
    { cabForward: 1 }, { requestedSpeed: -1 }, { requestedSpeed: 321 }, { requestedSpeed: NaN },
    { position: undefined }, { legacyStart: 'true' },
  ])('rejects a malformed train without silently dropping it: %j', patch => {
    const original = fleetLayout()
    expect(() => parseLayout({ ...original, trains: [{ ...original.trains![0], ...patch }, original.trains![1]] })).toThrow(/trainset/)
  })

  it.each([
    { trackId: 'deleted-track' }, { distance: -1 }, { distance: 100000 }, { distance: Infinity },
    { direction: 0 }, { laps: -1 }, { laps: .5 }, { route: -1 }, { route: 99 }, { route: .5 },
  ])('rejects a train cursor outside its own saved network: %j', patch => {
    const original = fleetLayout()
    expect(() => parseLayout({ ...original, trains: [
      { ...original.trains![0], position: { ...original.trains![0].position!, ...patch } }, original.trains![1],
    ] })).toThrow(/position/)
  })

  it('validates lane-specific positions and strips runtime properties from a saved train', () => {
    const original = fleetLayout()
    const track = { ...original.tracks[0], kind: 'ds248' }
    const train = { ...original.trains![0], position: { trackId: track.id, distance: 125, direction: -1, route: 1, laps: 2 }, actualSpeed: 90, running: true, status: 'moving' }
    const parsed = parseLayout({ ...original, tracks: [track], trains: [train], selectedTrainId: train.id })
    expect(parsed.trains![0].position).toEqual(train.position)
    expect(parsed.trains![0]).not.toHaveProperty('actualSpeed')
    expect(parsed.trains![0]).not.toHaveProperty('running')
    expect(parsed.trains![0]).not.toHaveProperty('status')
    expect(() => parseLayout({ ...original, selectedTrainId: 'deleted-train' })).toThrow(/selects a trainset/)
  })

  it('persists only a true legacy-start compatibility marker', () => {
    const original = fleetLayout()
    expect(parseLayout(original).trains![0].legacyStart).toBe(true)
    const trains = original.trains!.map(train => ({ ...train, legacyStart: false }))
    expect(parseLayout({ ...original, trains }).trains!.every(train => train.legacyStart === undefined)).toBe(true)
  })

  it('bounds imported fleet size to twelve trainsets while retaining the last valid schema', () => {
    const original = fleetLayout()
    const trains = Array.from({ length: MAX_TRAINSETS }, (_, index) => ({ ...original.trains![0], id: `train-${index + 1}` }))
    expect(parseLayout({ ...original, trains }).trains).toHaveLength(MAX_TRAINSETS)
    expect(() => parseLayout({ ...original, trains: [...trains, { ...trains[0], id: 'extra' }] })).toThrow(/at most 12/)
  })
})

describe('version 4 stable nose-coupled partnerships', () => {
  const paired = () => {
    const original = createLayout('coupling-demo')
    return { ...original, version: 4 as const, couplings: [{ id: 'pair-1', e6Id: original.trains![0].id, e5Id: original.trains![1].id }] }
  }

  it('round trips both member trainsets, their exact positions, selection and stable relation', () => {
    const original = paired()
    const parsed = parseLayout(JSON.parse(JSON.stringify(original)))
    expect(parsed).toEqual(original)
    expect(parsed.version).toBe(4)
    expect(parsed.couplings![0]).not.toBe(original.couplings[0])
    expect(parsed.trains![0].position).not.toBe(original.trains![0].position)
    expect(restoreFleet(parsed)).toHaveLength(2)
    expect(restoreFleet(parsed).every(train => !train.running && train.actualSpeed === 0)).toBe(true)
    parsed.couplings![0].id = 'different-id'
    expect(original.couplings[0].id).toBe('pair-1')
  })

  it('defaults an absent v4 relation list to empty and does not reinterpret older schemas', () => {
    const original = paired()
    expect(parseLayout({ ...original, couplings: undefined }).couplings).toEqual([])
    expect(parseLayout({ ...original, version: 3 })).not.toHaveProperty('couplings')
    expect(parseLayout({ ...createLayout('compact'), couplings: original.couplings })).not.toHaveProperty('couplings')
  })

  it('keeps only stable group fields and excludes partial opening, movement and locking commands', () => {
    const original = paired()
    const parsed = parseLayout({ ...original,
      couplingOperation: { phase: 'approaching' },
      couplings: [{ ...original.couplings[0], elapsed: 2, paused: false, open: .5, e6End: 'front', e5End: 'rear' }],
      trains: original.trains!.map(train => ({ ...train, noseCoupling: { open: .5, extension: .3, locked: false }, running: true })),
    })
    expect(parsed).toEqual(original)
  })

  it('upgrades an old stable partnership on its next fleet snapshot without losing its members or saved positions', () => {
    const original = paired()
    const before = JSON.stringify(original)
    const restored = restoreFleet(parseLayout(JSON.parse(before)))
    const upgraded = snapshotFleetLayout(original, restored, original.selectedTrainId)
    expect(upgraded.version).toBe(5)
    expect(upgraded.couplings).toEqual(original.couplings)
    expect(upgraded.trains!.map(train => train.position)).toEqual(original.trains!.map(train => train.position))
    expect(parseLayout(JSON.parse(JSON.stringify(upgraded)))).toEqual(upgraded)
    expect(JSON.stringify(original)).toBe(before)
    expect(restored.every(train => !train.running && train.actualSpeed === 0)).toBe(true)
  })

  it.each([
    { id: '' }, { id: 'x'.repeat(101) }, { id: 1 }, { e6Id: 'absent' }, { e5Id: 'absent' },
    { e6Id: 'coupling-demo-e5', e5Id: 'coupling-demo-e6' },
    { e6Id: 'coupling-demo-e6', e5Id: 'coupling-demo-e6' }, { e6Id: null }, { e5Id: 3 },
  ])('rejects malformed or incompatible coupling identities: %j', patch => {
    const original = paired()
    expect(() => parseLayout({ ...original, couplings: [{ ...original.couplings[0], ...patch }] })).toThrow(/coupling/)
  })

  it.each([null, 'pair-1', {}, Array(7).fill({ id: 'pair', e6Id: 'a', e5Id: 'b' })])('rejects an invalid group list: %j', couplings => {
    expect(() => parseLayout({ ...paired(), couplings })).toThrow(/coupled-train|coupling/)
  })

  it('rejects E7 and commuter train substitutions even when the referenced ids exist', () => {
    const original = paired()
    for (const type of ['e7', 'e235'] as const) {
      expect(() => parseLayout({ ...original, trains: original.trains!.map(train => train.type === 'e5' ? { ...train, type } : train) })).toThrow(/coupling/)
    }
  })

  it('supports several distinct pairs and rejects reused members or repeated group ids', () => {
    const original = paired()
    const trains = [...original.trains!, ...original.trains!.map(train => ({ ...train, id: `${train.id}-2` }))]
    const second = { id: 'pair-2', e6Id: trains[2].id, e5Id: trains[3].id }
    expect(parseLayout({ ...original, trains, couplings: [...original.couplings, second] }).couplings).toHaveLength(2)
    expect(() => parseLayout({ ...original, trains, couplings: [...original.couplings, { ...second, id: 'pair-1' }] })).toThrow(/coupling/)
    expect(() => parseLayout({ ...original, trains, couplings: [...original.couplings, { ...second, e6Id: trains[0].id }] })).toThrow(/coupling/)
    expect(() => parseLayout({ ...original, trains, couplings: [...original.couplings, { ...second, e5Id: trains[1].id }] })).toThrow(/coupling/)
  })
})

describe('version 5 playful Shinkansen partnerships', () => {
  const types = ['e5', 'e6', 'e7'] as const
  const ends = ['front', 'rear'] as const
  const combinations = types.flatMap(referenceType => types.flatMap(partnerType =>
    ends.flatMap(e6End => ends.map(e5End => ({ referenceType, partnerType, e6End, e5End }))))
  )
  const paired = () => {
    const original = createLayout('coupling-demo')
    return {
      ...original, version: 5 as const,
      couplings: [{ id: 'pair-1', e6Id: original.trains![0].id, e5Id: original.trains![1].id }],
    }
  }

  it.each(combinations)('round trips $referenceType $e6End with $partnerType $e5End', ({ referenceType, partnerType, e6End, e5End }) => {
    const original = paired()
    const group = { ...original.couplings[0], e6End, e5End }
    const candidate = { ...original, couplings: [group], trains: original.trains!.map((train, index) => ({
      ...train, type: index === 0 ? referenceType : partnerType, carCount: index === 0 ? 11 : 7,
      cabForward: index === 0,
    })) }
    const parsed = parseLayout(JSON.parse(JSON.stringify(candidate)))
    expect(parsed).toEqual(candidate)
    expect(parsed.couplings![0]).not.toBe(group)
    expect(parsed.trains![0].position).not.toBe(candidate.trains[0].position)
    expect(restoreFleet(parsed).map(train => train.carCount)).toEqual([11, 7])
    expect(restoreFleet(parsed).every(train => !train.running && train.actualSpeed === 0)).toBe(true)
  })

  it('keeps missing cab ends absent for the legacy rear/front defaults and allows explicit ends independently', () => {
    const original = paired()
    expect(parseLayout(original)).toEqual(original)
    for (const patch of [{ e6End: 'front' }, { e5End: 'rear' }] as const) {
      const couplings = [{ ...original.couplings[0], ...patch }]
      expect(parseLayout({ ...original, couplings }).couplings).toEqual(couplings)
    }
    expect(parseLayout({ ...original, couplings: undefined }).couplings).toEqual([])
  })

  it.each(['head', 'tail', 'FRONT', '', null, 1, {}, []])('rejects an invalid saved cab end: %j', end => {
    const original = paired()
    for (const field of ['e6End', 'e5End']) {
      expect(() => parseLayout({ ...original, couplings: [{ ...original.couplings[0], [field]: end }] })).toThrow(/coupling end/)
    }
  })

  it.each([
    { id: '' }, { id: 'x'.repeat(101) }, { id: 1 }, { e6Id: 'absent' }, { e5Id: 'absent' },
    { e6Id: 'coupling-demo-e6', e5Id: 'coupling-demo-e6' }, { e6Id: null }, { e5Id: 3 },
  ])('rejects malformed or missing group identities: %j', patch => {
    const original = paired()
    expect(() => parseLayout({ ...original, couplings: [{ ...original.couplings[0], ...patch }] })).toThrow(/coupling/)
  })

  it('rejects commuter members on either side while permitting the other Shinkansen combinations', () => {
    const original = paired()
    for (const commuterIndex of [0, 1]) {
      expect(() => parseLayout({ ...original, trains: original.trains!.map((train, index) => ({
        ...train, type: index === commuterIndex ? 'e235' : 'e7',
      })) })).toThrow(/coupling/)
    }
  })

  it('supports separate same-model pairs and prevents shared members or duplicate group IDs', () => {
    const original = paired()
    const trains = [...original.trains!, ...original.trains!.map(train => ({ ...train, id: `${train.id}-2` }))]
      .map(train => ({ ...train, type: 'e7' as const }))
    const second = { id: 'pair-2', e6Id: trains[2].id, e5Id: trains[3].id, e6End: 'front' as const, e5End: 'front' as const }
    expect(parseLayout({ ...original, trains, couplings: [...original.couplings, second] }).couplings).toHaveLength(2)
    for (const patch of [{ id: 'pair-1' }, { e6Id: trains[0].id }, { e5Id: trains[1].id }, { e6Id: trains[1].id }]) {
      expect(() => parseLayout({ ...original, trains, couplings: [...original.couplings, { ...second, ...patch }] })).toThrow(/coupling/)
    }
  })

  it('strips transient animation and commands while retaining both stable cab ends', () => {
    const original = paired()
    const couplings = [{ ...original.couplings[0], e6End: 'front' as const, e5End: 'rear' as const }]
    const parsed = parseLayout({ ...original, couplings: [{ ...couplings[0], phase: 'closing', elapsed: 2, paused: false }],
      couplingOperation: { phase: 'opening' }, trains: original.trains!.map(train => ({ ...train,
        running: true, actualSpeed: 50, noseCoupling: { end: 'rear', open: .5, extension: .3, locked: false },
      })),
    })
    expect(parsed).toEqual({ ...original, couplings })
  })
})
