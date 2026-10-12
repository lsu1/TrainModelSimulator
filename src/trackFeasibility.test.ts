import { describe, expect, it } from 'vitest'
import { KATO_CATALOG } from './catalog'
import { auditClearances } from './clearance'
import { makeKatoPlan02 } from './katoPlan'
import type { TrainSnapshot } from './fleet'
import type { LayoutData } from './layout'
import { attachTrack, connectedEndpoint, endpoints, makeStarterLayout, openEndpoints, SNAP_ANGLE, SNAP_DISTANCE } from './track'
import type { Endpoint, Track } from './track'
import { inspectTrackFeasibility, searchTrackFeasibility, TRACK_HELPER_LIMITS, validateTrackHelperSolution } from './trackFeasibility'
import type { TrackEndRef, TrackHelperRequest, TrackHelperSolution } from './trackHelperTypes'
import type { TrainType } from './trains'

const track = (id: string, kind: string, x = 0, y = 0, angle = 0): Track => ({ id, kind, x, y, angle, bend: 1 })
const layout = (tracks: Track[]): LayoutData => ({ version: 5, name: 'Helper test', carCount: 3, trainType: 'e235', tracks, accessories: [], trains: [] })
const end = (trackId: string, port: number): TrackEndRef => ({ trackId, end: port })
const difference = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))
const request = (railway: LayoutData, ends: [TrackEndRef, TrackEndRef], workLimit?: number): TrackHelperRequest => ({ layout: railway, ends, protectedTrackIds: [], ...(workLimit === undefined ? {} : { workLimit }) })
const train = (type: TrainType, trackId?: string): TrainSnapshot => ({ id: type, name: type, type, carCount: 3, cabForward: true, requestedSpeed: 65, position: trackId ? { trackId, distance: 30, direction: 1, laps: 0 } : null })

/** Two existing continuations, with a known catalog-sized missing section. */
function missingSection(kinds: string[], elevation = 0, angle = 0, bend: 1 | -1 = 1) {
  const a = { ...track('a', 's62', -62 * Math.cos(angle), -62 * Math.sin(angle), angle), elevation }
  let anchor: Endpoint = endpoints(a)[1]
  const missing = kinds.map((kind, index) => {
    const piece = attachTrack(kind, bend, anchor, `missing-${index}`)
    anchor = endpoints(piece)[1]
    return piece
  })
  const b = attachTrack('s62', 1, anchor, 'b')
  return { railway: layout([a, b]), ends: [end('a', 1), end('b', 0)] as [TrackEndRef, TrackEndRef], missing }
}

function repairFixture() {
  const a = track('a', 's62', -62)
  // A real catalog straight with a legal small joint yaw; it produces a
  // lateral error that a tangent-perfect finishing straight cannot absorb.
  const awkward = track('awkward', 's248', 0, 0, .2 * Math.PI / 180)
  const b = track('b', 's62', 496)
  return { railway: layout([a, awkward, b]), ends: [end('awkward', 1), end('b', 0)] as [TrackEndRef, TrackEndRef] }
}

function assertStrictFinish(railway: LayoutData, solution: TrackHelperSolution) {
  expect(validateTrackHelperSolution(railway, solution)).toMatchObject({ allowed: true })
  const proposed = [...railway.tracks.filter(piece => !solution.removeIds.includes(piece.id)), ...solution.tracks]
  expect(auditClearances({ ...railway, tracks: proposed }).filter(issue => issue.severity === 'error')).toEqual([])
  for (const piece of solution.tracks) {
    const item = KATO_CATALOG.find(item => item.kind === piece.kind)!
    expect(['straight', 'curve']).toContain(item.shape)
    for (const [port, endpoint] of endpoints(piece).entries()) {
      const connection = connectedEndpoint(proposed, piece.id, port)
      expect(connection).not.toBeNull()
      const peer = endpoints(connection!.track)[connection!.end]
      expect(Math.hypot(endpoint.position.x - peer.position.x, endpoint.position.y - peer.position.y)).toBeLessThanOrEqual(SNAP_DISTANCE)
      expect(difference(endpoint.angle, peer.angle + Math.PI)).toBeLessThanOrEqual(SNAP_ANGLE)
    }
  }
}

describe('track helper eligibility', () => {
  it('uses model millimetres and includes the 1,500 mm boundary', () => {
    const railway = layout([track('a', 's62', -62), track('b', 's62', 1500)])
    expect(inspectTrackFeasibility(railway, [end('a', 1), end('b', 0)])).toMatchObject({ eligible: true, gap: 1500, heightDifference: 0 })
    expect(inspectTrackFeasibility(railway, [end('a', 1), end('b', 0)]).angleDifference).toBeLessThan(1e-12)
    railway.tracks[1].x += .01
    expect(inspectTrackFeasibility(railway, [end('a', 1), end('b', 0)])).toMatchObject({ eligible: false })
  })

  it('requires two distinct existing open ports', () => {
    const fixture = missingSection(['s248'])
    expect(inspectTrackFeasibility(fixture.railway, [end('a', 1), end('a', 1)]).eligible).toBe(false)
    expect(inspectTrackFeasibility(fixture.railway, [end('a', 7), end('b', 0)]).eligible).toBe(false)
    expect(inspectTrackFeasibility(fixture.railway, [end('missing', 0), end('b', 0)]).eligible).toBe(false)
    fixture.railway.tracks.push(...fixture.missing)
    expect(inspectTrackFeasibility(fixture.railway, fixture.ends).message).toContain('already connected')
  })

  it('permits level elevated ends but explains unequal heights', () => {
    const fixture = missingSection(['s248'], 60)
    expect(inspectTrackFeasibility(fixture.railway, fixture.ends).eligible).toBe(true)
    fixture.railway.tracks[1].elevation = 65
    expect(inspectTrackFeasibility(fixture.railway, fixture.ends)).toMatchObject({ eligible: false, heightDifference: 5 })
  })

  it.each(['ds248', 'dc315', 'scissors'])('keeps %s outside the single-track finishing scope', kind => {
    const railway = layout([track('a', kind), track('b', 's62', 500)])
    expect(inspectTrackFeasibility(railway, [end('a', 1), end('b', 0)])).toMatchObject({ eligible: false, message: expect.stringContaining('single-track') })
  })

  it('does not search non-finite endpoint geometry', () => {
    const railway = layout([track('a', 's62', NaN), track('b', 's62', 500)])
    expect(searchTrackFeasibility(request(railway, [end('a', 1), end('b', 0)]))).toMatchObject({ status: 'ineligible', explored: 0 })
  })
})

describe('deterministic catalog finishing search', () => {
  it.each(['s29', 's45-5', 's248'])('finds a single %s without stretching or fitting joint yaw', kind => {
    const fixture = missingSection([kind])
    const result = searchTrackFeasibility(request(fixture.railway, fixture.ends))
    expect(result.status).toBe('found')
    expect(result.solutions[0].tracks).toHaveLength(1)
    expect(result.solutions[0].removeIds).toEqual([])
    assertStrictFinish(fixture.railway, result.solutions[0])
  })

  it.each([1, -1] as const)('finishes a rotated %i-handed curve section', bend => {
    const fixture = missingSection(['c315', 'c315'], 0, .73, bend)
    const result = searchTrackFeasibility(request(fixture.railway, fixture.ends))
    expect(result.status).toBe('found')
    expect(result.solutions[0].tracks).toHaveLength(2)
    assertStrictFinish(fixture.railway, result.solutions[0])
  })

  it('suggests matching viaduct geometry at a level raised gap', () => {
    const fixture = missingSection(['s248'], 60)
    const result = searchTrackFeasibility(request(fixture.railway, fixture.ends))
    expect(result.status).toBe('found')
    expect(result.solutions[0].tracks[0]).toMatchObject({ kind: 'v248', elevation: 60 })
    assertStrictFinish(fixture.railway, result.solutions[0])
  })

  it('distinguishes a completed loop from connecting separate tracks', () => {
    const tracks = makeStarterLayout('oval').slice(2)
    const ports = openEndpoints(tracks)
    const railway = layout(tracks)
    const result = searchTrackFeasibility(request(railway, ports.map(port => end(port.track.id, port.end)) as [TrackEndRef, TrackEndRef]))
    expect(result.status).toBe('found')
    expect(result.solutions[0]).toMatchObject({ closesLoop: true })
    expect(result.solutions[0].tracks).toHaveLength(2)
    assertStrictFinish(railway, result.solutions[0])
    const separate = missingSection(['s248'])
    expect(searchTrackFeasibility(request(separate.railway, separate.ends)).solutions[0].closesLoop).toBe(false)
  })

  it('accepts an existing turnout branch as an anchor without adding or removing turnouts', () => {
    const turnout = { ...track('a', 't6l'), switchState: 'branch' as const }
    const added = attachTrack('c718', -1, endpoints(turnout)[2], 'missing')
    const continuation = attachTrack('s62', 1, endpoints(added)[1], 'b')
    const railway = layout([turnout, continuation])
    const result = searchTrackFeasibility(request(railway, [end('a', 2), end('b', 0)]))
    expect(result.status).toBe('found')
    expect(result.solutions[0].removeIds).not.toContain('a')
    assertStrictFinish(railway, result.solutions[0])
  })

  it('returns identical suggestions and work counts without changing any input', () => {
    const fixture = missingSection(['s248', 's248'])
    const input = request(fixture.railway, fixture.ends)
    const before = structuredClone(input)
    const first = searchTrackFeasibility(input)
    expect(searchTrackFeasibility(structuredClone(input))).toEqual(first)
    expect(input).toEqual(before)
    expect(first.explored).toBeLessThanOrEqual(TRACK_HELPER_LIMITS.work)
  })

  it('uses stable preview IDs that cannot collide with imported piece IDs', () => {
    const fixture = missingSection(['s248'])
    fixture.railway.tracks.push(track('helper-left-0', 's29', 3000))
    const result = searchTrackFeasibility(request(fixture.railway, fixture.ends))
    expect(result.status).toBe('found')
    expect(result.solutions[0].tracks[0].id).not.toBe('helper-left-0')
    assertStrictFinish(fixture.railway, result.solutions[0])
  })

  it('reports exhausted fixed work separately from a completed no-fit search', () => {
    const fixture = missingSection(['s248'])
    expect(searchTrackFeasibility(request(fixture.railway, fixture.ends, 5))).toMatchObject({ status: 'limit', explored: 5, solutions: [] })
    fixture.railway.tracks[1].angle = Math.PI / 180
    const impossible = searchTrackFeasibility(request(fixture.railway, fixture.ends, 5))
    expect(impossible).toMatchObject({ status: 'no-fit', explored: 0, solutions: [] })
    expect(impossible.message).toContain('checked single-track choices')
  })

  it('uses a repeatable default budget even when repair searches remain', () => {
    const railway = layout([track('a-back', 's62', -124), track('a', 's62', -62), track('b', 's62', 200, .4), track('b-back', 's62', 262, .4)])
    const result = searchTrackFeasibility(request(railway, [end('a', 1), end('b', 0)]))
    expect(result).toMatchObject({ status: 'limit', solutions: [], explored: TRACK_HELPER_LIMITS.work })
  })

  it('normalizes large imported angles without losing rotated arc extrema', () => {
    const fixture = missingSection(['c315', 'c315'], 0, .73 + 100 * Math.PI * 2)
    const result = searchTrackFeasibility(request(fixture.railway, fixture.ends))
    expect(result.status).toBe('found')
    assertStrictFinish(fixture.railway, result.solutions[0])
  })
})

describe('verified small repairs', () => {
  it('reserves work for a repair after a direct search reaches its share', () => {
    const fixture = repairFixture()
    const input = { ...request(fixture.railway, fixture.ends, 3000), protectedTrackIds: ['a', 'b'] }
    const result = searchTrackFeasibility(input)
    expect(result.status).toBe('found')
    expect(result.solutions[0].removeIds).toEqual(['awkward'])
    expect(result.solutions[0].tracks).toHaveLength(2)
    expect(result.solutions[0].ends).toEqual(fixture.ends)
    assertStrictFinish(fixture.railway, result.solutions[0])
  })

  it('does not remove a protected terminal piece', () => {
    const fixture = repairFixture()
    const result = searchTrackFeasibility({ ...request(fixture.railway, fixture.ends, 3000), protectedTrackIds: ['a', 'awkward', 'b'] })
    expect(result.solutions.every(solution => !solution.removeIds.includes('awkward'))).toBe(true)
  })

  it('revalidates occupied removals and protects branching pieces', () => {
    const fixture = repairFixture()
    const result = searchTrackFeasibility({ ...request(fixture.railway, fixture.ends, 3000), protectedTrackIds: ['a', 'b'] })
    const solution = result.solutions[0]
    fixture.railway.trains = [train('e235', 'awkward')]
    expect(validateTrackHelperSolution(fixture.railway, solution)).toMatchObject({ allowed: false, message: expect.stringContaining('occupies') })
    const branching = { ...repairFixture().railway, trains: [] }
    branching.tracks[1].kind = 't6l'
    expect(validateTrackHelperSolution(branching, solution).allowed).toBe(false)
  })

  it('can verify removal alone when it clears duplicate terminal pieces', () => {
    // The graph currently favors each duplicate terminal piece over the
    // other retained connector. Removing both restores the retained joint.
    const railway = layout([track('remove-right', 's62'), track('remove-left', 's62', -61.9), track('a', 's62', -62), track('b', 's62', .1)])
    const result = searchTrackFeasibility({ ...request(railway, [end('remove-right', 1), end('remove-left', 0)], 3000), protectedTrackIds: ['a', 'b'] })
    expect(result.status).toBe('found')
    expect(result.solutions[0].removeIds.sort()).toEqual(['remove-left', 'remove-right'])
    expect(result.solutions[0].tracks).toEqual([])
    expect(result.solutions[0].closesLoop).toBe(false)
    assertStrictFinish(railway, result.solutions[0])
  })
})

describe('proposal validation against the current railway', () => {
  it('rejects stale endpoints, extra disconnected pieces, duplicate IDs, and reused removed IDs', () => {
    const fixture = missingSection(['s248'])
    const valid = searchTrackFeasibility(request(fixture.railway, fixture.ends)).solutions[0]
    const moved = structuredClone(fixture.railway)
    moved.tracks[1].x += 1
    expect(validateTrackHelperSolution(moved, valid).allowed).toBe(false)
    expect(validateTrackHelperSolution(fixture.railway, { ...valid, tracks: [...valid.tracks, track('extra', 's29', 300, 300)] }).allowed).toBe(false)
    expect(validateTrackHelperSolution(fixture.railway, { ...valid, tracks: [{ ...valid.tracks[0], id: 'a' }] }).allowed).toBe(false)
    const repair = repairFixture()
    const repaired = searchTrackFeasibility({ ...request(repair.railway, repair.ends, 3000), protectedTrackIds: ['a', 'b'] }).solutions[0]
    expect(validateTrackHelperSolution(repair.railway, { ...repaired, tracks: repaired.tracks.map((piece, index) => index ? piece : { ...piece, id: 'awkward' }) }).allowed).toBe(false)
  })

  it.each(['e5', 'e7'] as const)('honors %s radius limits even when an E235 is selected', type => {
    const fixture = missingSection(['c282'])
    const solution: TrackHelperSolution = { tracks: fixture.missing, removeIds: [], ends: fixture.ends, closesLoop: false }
    expect(validateTrackHelperSolution(fixture.railway, solution).allowed).toBe(true)
    fixture.railway.trains = [train('e235'), train(type)]
    fixture.railway.selectedTrainId = 'e235'
    expect(validateTrackHelperSolution(fixture.railway, solution).allowed).toBe(false)
  })

  it('does not invent a hard R315 minimum for E235, and accepts E6 R282', () => {
    const fixture = missingSection(['c249'])
    expect(validateTrackHelperSolution(fixture.railway, { tracks: fixture.missing, removeIds: [], ends: fixture.ends, closesLoop: false }).allowed).toBe(true)
    const e6 = missingSection(['c282'])
    e6.railway.trains = [train('e6')]
    expect(validateTrackHelperSolution(e6.railway, { tracks: e6.missing, removeIds: [], ends: e6.ends, closesLoop: false }).allowed).toBe(true)
  })

  it('rejects a geometrically connected finishing section through another track or scenery', () => {
    const fixture = missingSection(['s248'])
    const solution: TrackHelperSolution = { tracks: fixture.missing, removeIds: [], ends: fixture.ends, closesLoop: false }
    fixture.railway.tracks.push(track('obstruction', 's248', 124, -124, Math.PI / 2))
    expect(validateTrackHelperSolution(fixture.railway, solution)).toMatchObject({ allowed: false, message: expect.stringContaining('overlap') })
    fixture.railway.tracks.pop()
    fixture.railway.accessories.push({ id: 'building', kind: 'a-station', x: 124, y: 0, angle: 0, elevation: 0 })
    expect(validateTrackHelperSolution(fixture.railway, solution).allowed).toBe(false)
  })

  it('rejects malformed proposals and piece-limit overflow without throwing', () => {
    const fixture = missingSection(['s248'])
    const valid = { tracks: fixture.missing, removeIds: [], ends: fixture.ends, closesLoop: false }
    expect(validateTrackHelperSolution(fixture.railway, null as unknown as TrackHelperSolution).allowed).toBe(false)
    expect(validateTrackHelperSolution(fixture.railway, { ...valid, tracks: [{ ...fixture.missing[0], x: Infinity }] }).allowed).toBe(false)
    expect(validateTrackHelperSolution(fixture.railway, { ...valid, tracks: [{ ...fixture.missing[0], elevation: -.1 }] }).allowed).toBe(false)
    expect(validateTrackHelperSolution(fixture.railway, { ...valid, tracks: [{ ...fixture.missing[0], elevation: 0, endElevation: .1 }] }).allowed).toBe(false)
    expect(validateTrackHelperSolution(fixture.railway, { ...valid, tracks: Array(7).fill(fixture.missing[0]) }).allowed).toBe(false)
    fixture.railway.tracks.push(...Array.from({ length: 298 }, (_, index) => track(`far-${index}`, 's29', 3000 + index * 100)))
    expect(validateTrackHelperSolution(fixture.railway, valid)).toMatchObject({ allowed: false, message: expect.stringContaining('piece limit') })
  })

  it.each(['t6l', 'x90', 'ds248', 'scissors'])('rejects newly proposed %s outside the finishing catalog', kind => {
    const fixture = missingSection(['s248'])
    expect(validateTrackHelperSolution(fixture.railway, { tracks: [{ ...fixture.missing[0], kind }], removeIds: [], ends: fixture.ends, closesLoop: false }).allowed).toBe(false)
  })

  it('checks overlapping candidate finishes before suggesting them', () => {
    const fixture = missingSection(['s248'])
    fixture.railway.tracks.push(track('crossing-obstruction', 's248', 124, -124, Math.PI / 2))
    const result = searchTrackFeasibility(request(fixture.railway, fixture.ends, 3000))
    expect(result.solutions).toEqual([])
    expect(result.status).toBe('limit')
  })

  it.each(['s62-buffer-a', 's50-buffer-c'])('never turns %s into a through finishing piece', kind => {
    const fixture = missingSection([kind])
    expect(validateTrackHelperSolution(fixture.railway, { tracks: fixture.missing, removeIds: [], ends: fixture.ends, closesLoop: false }).allowed).toBe(false)
    const result = searchTrackFeasibility(request(fixture.railway, fixture.ends))
    expect(result.solutions.every(solution => solution.tracks.every(piece => !piece.kind.includes('-buffer-')))).toBe(true)
  })

  it('rejects an otherwise connected detour outside the permitted area', () => {
    const fixture = missingSection(['c315', 's248', 'c315', 'c315', 'c315', 's248'])
    expect(validateTrackHelperSolution(fixture.railway, { tracks: fixture.missing, removeIds: [], ends: fixture.ends, closesLoop: false })).toMatchObject({ allowed: false, message: expect.stringContaining('finishing area') })
  })

  it('preserves the strict dimensions and tolerances of fitted M1 + V1 + V2 geometry', () => {
    const railway = makeKatoPlan02()
    const removed = railway.tracks.find(piece => piece.id === 'kato-plan02-main-25')!
    const a = connectedEndpoint(railway.tracks, removed.id, 0)!
    const b = connectedEndpoint(railway.tracks, removed.id, 1)!
    railway.tracks = railway.tracks.filter(piece => piece.id !== removed.id)
    const ends: [TrackEndRef, TrackEndRef] = [end(a.track.id, a.end), end(b.track.id, b.end)]
    const result = searchTrackFeasibility({ ...request(railway, ends), protectedTrackIds: railway.tracks.map(piece => piece.id) })
    expect(result.status).toBe('found')
    expect(result.solutions[0].tracks.length).toBeLessThanOrEqual(TRACK_HELPER_LIMITS.pieces)
    assertStrictFinish(railway, result.solutions[0])
  })
})
