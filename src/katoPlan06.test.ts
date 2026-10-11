import { describe, expect, it } from 'vitest'
import { KATO_CATALOG } from './catalog'
import { auditConnections } from './engineering'
import { makeKatoPlan06 } from './katoPlan06'
import { getLayoutPieceLimit, parseLayout } from './layout'
import { readSavedDesigns, saveDesignSnapshot, SAVED_DESIGNS_KEY } from './savedDesigns'
import { supportsStationName } from './stationName'
import { connectedEndpoint, endpoints, openEndpoints, pathsFor, SNAP_ANGLE, SNAP_DISTANCE, SNAP_HEIGHT } from './track'
import type { Track } from './track'
import { TRAIN_TYPES } from './trains'

const catalog = new Map(KATO_CATALOG.map(item => [item.kind, item]))
const headingGap = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))

/** Rail components, keeping the two lanes of a double-track body separate. */
function railComponents(tracks: Track[]): { ids: Set<string>; elevations: Set<number> }[] {
  const edges = new Map<string, Set<string>>()
  const byId = new Map(tracks.map(track => [track.id, track]))
  const key = (id: string, end: number) => `${id}/${end}`
  const join = (a: string, b: string) => {
    if (!edges.has(a)) edges.set(a, new Set())
    if (!edges.has(b)) edges.set(b, new Set())
    edges.get(a)!.add(b)
    edges.get(b)!.add(a)
  }
  for (const track of tracks) {
    for (const path of pathsFor(track)) join(key(track.id, path.startPort), key(track.id, path.endPort))
    for (const [port] of endpoints(track).entries()) {
      const peer = connectedEndpoint(tracks, track.id, port)
      if (peer) join(key(track.id, port), key(peer.track.id, peer.end))
    }
  }
  const unseen = new Set(edges.keys())
  const components: { ids: Set<string>; elevations: Set<number> }[] = []
  while (unseen.size) {
    const queue = [unseen.values().next().value!]
    const visited = new Set<string>()
    const ids = new Set<string>()
    const elevations = new Set<number>()
    while (queue.length) {
      const port = queue.pop()!
      if (visited.has(port)) continue
      visited.add(port)
      unseen.delete(port)
      const id = port.slice(0, port.lastIndexOf('/'))
      ids.add(id)
      elevations.add(byId.get(id)!.elevation ?? 0)
      queue.push(...edges.get(port)!)
    }
    components.push({ ids, elevations })
  }
  return components
}

describe('official KATO plan 06-15', () => {
  it('includes the drawn operational inventory without surplus or duplicated shed callouts', () => {
    const layout = makeKatoPlan06()
    const inventory: Record<string, number> = {}
    for (const track of layout.tracks) inventory[track.kind] = (inventory[track.kind] ?? 0) + 1
    // The drawing has six exploded-view S248 labels below the train sheds;
    // those rails also appear beneath the roofs and are counted once here.
    expect(inventory).toEqual({
      s248: 72, 's248-pc': 16, s186: 8, s124: 4, 's124-pc': 8,
      s64: 10, s62: 14, 's62-feeder': 2, s29: 8, 's45-5': 2,
      s60l: 3, s60r: 13, 's62-buffer-a': 2, 's50-buffer-c': 2,
      's124-signal': 2, 's124-crossing-s': 2, 's62-sensor': 4,
      c315: 8, c348: 4, 'c348-30': 2, c381: 2, c481: 15, c718: 8,
      t4l: 7, t4r: 9, t6l: 4, t6r: 4, 'x15r-plan06-15': 1,
      ds248: 15, ds124: 4, dc414: 3, 'dc414-approach': 6,
      dv248: 4, dv186: 6, dv124: 1, dv414: 5, 'dv414-approach': 10,
      'db248-blue': 4,
    })
    expect(layout.tracks).toHaveLength(294)
    expect(layout).toMatchObject({ name: '新干线与在来线交错运行', sourcePlan: 'kato-plan06-15' })
    expect(layout.tracks.filter(track => track.switchNumber).map(track => track.switchNumber).sort((a, b) => a! - b!))
      .toEqual(Array.from({ length: 24 }, (_, index) => index + 1))
    expect(layout.tracks.filter(track => (track.elevation ?? 0) === 60)).toHaveLength(72)
    expect(layout.tracks.every(track => (track.endElevation ?? track.elevation ?? 0) === (track.elevation ?? 0))).toBe(true)
    expect(TRAIN_TYPES).toEqual(['e235', 'e5', 'e6', 'e7'])
    expect(layout.trains?.every(train => TRAIN_TYPES.includes(train.type))).toBe(true)
    expect(layout.trains?.map(train => train.type).sort()).toEqual(['e235', 'e5', 'e6'])
  })

  it('places the station assemblies, train sheds, crossing fixtures and all 45 illustrated supports', () => {
    const layout = makeKatoPlan06()
    const inventory: Record<string, number> = {}
    for (const accessory of layout.accessories) inventory[accessory.kind] = (inventory[accessory.kind] ?? 0) + 1
    expect(inventory).toEqual({
      'a-pier-frame-p06': 29, 'a-pier-double-p06': 16,
      'a-platform-suburban-island': 6, 'a-platform-suburban-island-stairs': 2,
      'a-platform-suburban-island-end': 4, 'a-platform-suburban-side': 10,
      'a-platform-suburban-side-stairs-left': 2, 'a-platform-suburban-side-stairs-right': 2,
      'a-platform-suburban-side-end-left': 2, 'a-platform-suburban-side-end-right': 2,
      'a-platform-local-p06': 8, 'a-platform-local-p06-slope': 4,
      'a-platform-local-p06-end-af': 2, 'a-platform-local-p06-end-bf': 2,
      'a-station-deck-248': 22,
      'a-station-wall-high-window': 2, 'a-station-wall-high': 16, 'a-station-wall-low': 4,
      'a-station-wall-end-left': 2, 'a-station-wall-end-right': 2,
      'a-station-p06': 2, 'a-station-shops-p06': 4, 'a-station-local-p06': 1,
      'a-station-overtrack': 1, 'a-station-overtrack-extension': 1, 'a-station-overtrack-stairs-right': 1,
      'a-train-shed': 4, 'a-auto-crossing-main': 1, 'a-auto-crossing-opposite': 1, 'a-auto-crossing-slope': 2,
    })
    expect(layout.accessories).toHaveLength(157)
    expect(layout.accessories.filter(accessory => catalog.get(accessory.kind)?.accessoryType === 'pier')
      .every(pier => pier.elevation === 0)).toBe(true)
    expect(layout.accessories.filter(accessory => accessory.kind === 'a-station-deck-248')
      .every(deck => deck.elevation === 60)).toBe(true)
  })

  it('connects only the intended rails within unchanged strict tolerances', () => {
    const layout = makeKatoPlan06()
    const open = openEndpoints(layout.tracks)
    expect(open.map(port => [port.track.kind, port.end]).sort()).toEqual([
      ['s50-buffer-c', 1], ['s50-buffer-c', 1], ['s62-buffer-a', 1], ['s62-buffer-a', 1],
    ])
    for (const track of layout.tracks) {
      for (const [port, endpoint] of endpoints(track).entries()) {
        const connection = connectedEndpoint(layout.tracks, track.id, port)
        if (!connection) continue
        const peer = endpoints(connection.track)[connection.end]
        expect(Math.hypot(endpoint.position.x - peer.position.x, endpoint.position.y - peer.position.y), `${track.id}/${port}`)
          .toBeLessThanOrEqual(SNAP_DISTANCE)
        expect(Math.abs((endpoint.position.z ?? 0) - (peer.position.z ?? 0))).toBeLessThanOrEqual(SNAP_HEIGHT)
        expect(headingGap(endpoint.angle, peer.angle + Math.PI)).toBeLessThanOrEqual(SNAP_ANGLE)
        const reciprocal = connectedEndpoint(layout.tracks, connection.track.id, connection.end)
        expect(reciprocal?.track.id).toBe(track.id)
        expect(reciprocal?.end).toBe(port)
      }
      const spec = catalog.get(track.kind)!
      if (spec.shape === 'straight') {
        const [start, end] = endpoints(track)
        expect(Math.hypot(end.position.x - start.position.x, end.position.y - start.position.y))
          .toBeCloseTo(spec.length, 7)
      }
    }
    expect(auditConnections(layout.tracks).filter(issue => issue.severity === 'error')).toEqual([])
    const components = railComponents(layout.tracks)
    expect(components).toHaveLength(3)
    expect(components.every(component => component.elevations.size === 1)).toBe(true)
    expect(components.filter(component => component.elevations.has(0)).map(component => component.ids.size)).toEqual([222])
    expect(components.filter(component => component.elevations.has(60)).map(component => component.ids.size)).toEqual([56, 56])
    const points = layout.tracks.flatMap(track => pathsFor(track).flatMap(path =>
      Array.from({ length: 17 }, (_, index) => path.pointAt(path.length * index / 16))))
    const width = Math.max(...points.map(point => point.x)) - Math.min(...points.map(point => point.x))
    const depth = Math.max(...points.map(point => point.y)) - Math.min(...points.map(point => point.y))
    // Rail centerlines sit inside the printed 4153 × 2458 mm overall footprint.
    expect(width).toBeGreaterThan(3970)
    expect(width).toBeLessThan(4090)
    expect(depth).toBeGreaterThan(2320)
    expect(depth).toBeLessThan(2450)
  })

  it('retains source, station names and the existing fleet through exports and named saves', () => {
    const layout = makeKatoPlan06()
    const platforms = layout.accessories.filter(accessory => supportsStationName(catalog.get(accessory.kind)?.accessoryType))
    expect(platforms.length).toBeGreaterThan(20)
    platforms[0].stationName = '新大阪 Shin-Osaka'
    platforms[1].stationName = '東京 Tokyo'
    const expected = parseLayout(layout)
    expect(parseLayout(JSON.parse(JSON.stringify(layout)))).toEqual(expected)
    expect(layout.tracks.length + layout.accessories.length).toBeGreaterThan(300)
    expect(getLayoutPieceLimit()).toBe(300)
    expect(getLayoutPieceLimit('kato-plan02-1a')).toBe(300)
    expect(getLayoutPieceLimit('kato-plan06-15')).toBeGreaterThanOrEqual(layout.tracks.length + layout.accessories.length)
    expect(() => parseLayout({ ...layout, sourcePlan: undefined })).toThrow('more than 300 pieces')
    expect(() => parseLayout({ ...layout, sourcePlan: 'unknown-plan' })).toThrow('unrecognized source plan')
    const { library } = saveDesignSnapshot({ version: 1, designs: [] }, layout, layout.name, null, false,
      { id: 'new-kato-plan', updatedAt: '2026-10-11T00:00:00Z' })
    const result = readSavedDesigns({ getItem: key => key === SAVED_DESIGNS_KEY ? JSON.stringify(library) : null, setItem: () => {} })
    expect(result.error).toBeNull()
    expect(result.library.designs[0].layout).toEqual(expected)
    const other = makeKatoPlan06()
    expect(other.accessories.find(accessory => accessory.id === platforms[0].id)!.stationName).not.toBe('新大阪 Shin-Osaka')
    layout.tracks[0].x += 100
    expect(other.tracks[0].x).not.toBe(layout.tracks[0].x)
  })
})
