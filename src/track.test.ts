import { describe, expect, it } from 'vitest'
import {
  TRACK_CATALOG,
  advanceTrain,
  attachTrack,
  closedRouteLength,
  connectedEndpoint,
  endpoints,
  makeCityLayout,
  makeStarterLayout,
  makeViaductLayout,
  openEndpoints,
  pathsFor,
  pointAt,
  sampleBehind,
  snapTrack,
  trackLength,
  trackPath,
  type Track,
  type TrainPosition,
} from './track'

const straight: Track = { id: 'straight', kind: 's248', x: 0, y: 0, angle: 0, bend: 1 }
const initial = (track: Track, direction: 1 | -1 = 1): TrainPosition => ({
  trackId: track.id,
  distance: direction === 1 ? 0 : trackLength(track),
  direction,
  laps: 0,
})
const angleError = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))

describe('track geometry', () => {
  it('uses Kato straight lengths and each catalog curve angle', () => {
    expect(trackLength('s248')).toBe(248)
    expect(trackLength('s124')).toBe(124)
    expect(trackLength('s62')).toBe(62)
    for (const spec of TRACK_CATALOG.filter((piece) => piece.radius !== undefined)) {
      expect(spec.length).toBeCloseTo(spec.radius! * spec.angle!)
    }
  })

  it('computes both curve bends and rotated tangents', () => {
    const clockwise: Track = { ...straight, kind: 'c282' }
    const end = pointAt(clockwise, trackLength(clockwise))
    expect(end.x).toBeCloseTo(282 / Math.sqrt(2))
    expect(end.y).toBeCloseTo(282 * (1 - 1 / Math.sqrt(2)))
    expect(end.angle).toBeCloseTo(Math.PI / 4)
    const opposite = pointAt({ ...clockwise, bend: -1 }, trackLength(clockwise))
    expect(opposite.x).toBeCloseTo(end.x)
    expect(opposite.y).toBeCloseTo(-end.y)
    expect(opposite.angle).toBeCloseTo(-Math.PI / 4)
    const rotated = pointAt({ ...clockwise, angle: Math.PI / 2, x: 10, y: 20 }, trackLength(clockwise))
    expect(rotated.x).toBeCloseTo(10 - end.y)
    expect(rotated.y).toBeCloseTo(20 + end.x)
    expect(rotated.angle).toBeCloseTo(3 * Math.PI / 4)
    expect(trackPath(clockwise)).toContain('A 282 282 0 0 1')
    expect(trackPath({ ...clockwise, bend: -1 })).toContain('A 282 282 0 0 0')
  })

  it('attaches to either outgoing endpoint and rejects misaligned joins', () => {
    const forward = attachTrack('c249', 1, endpoints(straight)[1], 'forward')
    const backward = attachTrack('s124', 1, endpoints(straight)[0], 'backward')
    const tracks = [straight, forward, backward]
    expect(connectedEndpoint(tracks, straight.id, 1)).toEqual({ track: forward, end: 0 })
    expect(connectedEndpoint(tracks, straight.id, 0)).toEqual({ track: backward, end: 0 })
    expect(angleError(endpoints(straight)[0].angle, Math.PI)).toBeLessThan(1e-8)
    expect(connectedEndpoint([straight, { ...forward, angle: Math.PI / 2 }], straight.id, 1)).toBeNull()
    expect(connectedEndpoint([straight, { ...forward, x: forward.x + 4 }], straight.id, 1)).toBeNull()
    expect(connectedEndpoint([straight, { ...forward, x: forward.x + 2 }], straight.id, 1)).not.toBeNull()
  })

  it.each(['oval', 'compact'] as const)('builds a closed %s with continuous tangents', (kind) => {
    const tracks = makeStarterLayout(kind)
    expect(tracks).toHaveLength(12)
    expect(openEndpoints(tracks)).toHaveLength(0)
    for (let index = 0; index < tracks.length; index += 1) {
      const connection = connectedEndpoint(tracks, tracks[index].id, 1)
      expect(connection?.track.id).toBe(tracks[(index + 1) % tracks.length].id)
      const a = endpoints(tracks[index])[1]
      const b = endpoints(connection!.track)[0]
      expect(Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y)).toBeLessThan(1e-8)
      expect(angleError(a.angle, b.angle + Math.PI)).toBeLessThan(1e-8)
    }
  })
})

describe('train traversal', () => {
  it('measures only the reachable closed circuit, in either direction', () => {
    const tracks = makeStarterLayout('oval')
    const otherLoop = makeStarterLayout('compact').map((track) => ({ ...track, id: `other-${track.id}`, x: track.x + 10_000 }))
    const length = tracks.reduce((total, track) => total + trackLength(track), 0)
    expect(closedRouteLength([...tracks, ...otherLoop], initial(tracks[0]))).toBeCloseTo(length)
    expect(closedRouteLength(tracks, initial(tracks[5], -1))).toBeCloseTo(length)
    expect(closedRouteLength([straight], initial(straight))).toBeNull()
    expect(closedRouteLength([], initial(straight))).toBeNull()
    const incoming: Track = { ...straight, id: 'incoming', kind: 's62', x: tracks[0].x - 62, y: tracks[0].y }
    expect(closedRouteLength([...tracks, incoming], initial(incoming))).toBeNull()
  })

  it('traverses a complete oval and counts a lap at the first piece', () => {
    const tracks = makeStarterLayout('oval')
    const length = tracks.reduce((total, track) => total + trackLength(track), 0)
    const result = advanceTrain(tracks, initial(tracks[0]), length + 35)
    expect(result.stopped).toBe(false)
    expect(result.lapsAdded).toBe(1)
    expect(result.position).toEqual({ ...initial(tracks[0]), distance: expect.closeTo(35), laps: 1 })
  })

  it('handles a large time step by skipping complete cycles', () => {
    const tracks = makeStarterLayout('compact')
    const length = tracks.reduce((total, track) => total + trackLength(track), 0)
    const result = advanceTrain(tracks, initial(tracks[0]), length * 100_000 + 12)
    expect(result.stopped).toBe(false)
    expect(result.lapsAdded).toBe(100_000)
    expect(result.position.trackId).toBe(tracks[0].id)
    expect(result.position.distance).toBeCloseTo(12, 3)
  })

  it('traverses an oval backwards and preserves the direction', () => {
    const tracks = makeStarterLayout('oval')
    const length = tracks.reduce((total, track) => total + trackLength(track), 0)
    const result = advanceTrain(tracks, initial(tracks[0], -1), length + 40)
    expect(result.stopped).toBe(false)
    expect(result.lapsAdded).toBe(1)
    expect(result.position.trackId).toBe(tracks[0].id)
    expect(result.position.direction).toBe(-1)
    expect(result.position.distance).toBeCloseTo(trackLength(tracks[0]) - 40)
  })

  it('changes direction when entering the other piece through its end', () => {
    const reversePiece: Track = { id: 'reverse', kind: 's124', x: 372, y: 0, angle: Math.PI, bend: 1 }
    const result = advanceTrain([straight, reversePiece], initial(straight), 270)
    expect(result.stopped).toBe(false)
    expect(result.position.trackId).toBe(reversePiece.id)
    expect(result.position.direction).toBe(-1)
    expect(result.position.distance).toBeCloseTo(102)
    const pose = sampleBehind([straight, reversePiece], result.position, 12)!
    expect(pose.x).toBeCloseTo(258)
    expect(pose.y).toBeCloseTo(0)
    expect(angleError(pose.angle, 0)).toBeLessThan(1e-8)
  })

  it('stops at open ends in both directions and handles a missing piece', () => {
    const forward = advanceTrain([straight], initial(straight), 1_000)
    expect(forward.stopped).toBe(true)
    expect(forward.position.distance).toBe(248)
    const backward = advanceTrain([straight], initial(straight, -1), 1_000)
    expect(backward.stopped).toBe(true)
    expect(backward.position.distance).toBe(0)
    expect(advanceTrain([], initial(straight), 10).stopped).toBe(true)
    expect(sampleBehind([straight], { ...initial(straight), distance: 5 }, 20)).toBeNull()
    expect(sampleBehind([straight], { ...initial(straight), distance: 20 }, 20)?.x).toBeCloseTo(0)
  })

  it('samples a rear bogie continuously across a straight-to-curve join', () => {
    const curve = attachTrack('c282', 1, endpoints(straight)[1], 'curve')
    const tracks = [straight, curve]
    const front: TrainPosition = { trackId: curve.id, distance: 15, direction: 1, laps: 0 }
    const rear = sampleBehind(tracks, front, 30)!
    expect(rear.x).toBeCloseTo(233)
    expect(rear.y).toBeCloseTo(0)
    expect(angleError(rear.angle, 0)).toBeLessThan(1e-8)
    const onStraight = sampleBehind(tracks, { ...front, distance: 30 - 0.001 }, 30)!
    const onCurve = sampleBehind(tracks, { ...front, distance: 30 + 0.001 }, 30)!
    expect(Math.hypot(onCurve.x - onStraight.x, onCurve.y - onStraight.y)).toBeCloseTo(0.002, 5)
    expect(angleError(onCurve.angle, onStraight.angle)).toBeLessThan(0.00001)
  })
})

const piece = (shape: 'turnout' | 'crossing' | 'doubleStraight' | 'doubleCurve' | 'scissors'): Track => ({
  ...straight, id: shape, kind: TRACK_CATALOG.find((item) => item.shape === shape)!.kind,
})
const leadsFor = (track: Track): Track[] => endpoints(track).map((endpoint, port) =>
  attachTrack('s124', 1, endpoint, `lead-${port}`))

describe('elevation and drag joins', () => {
  it('interpolates gradient height and continues onto an elevated flat piece', () => {
    const ramp: Track = { ...straight, elevation: 20, endElevation: 80 }
    const middle = pointAt(ramp, 124)
    expect(middle.z).toBe(50)
    expect(middle.slope).toBeCloseTo(60 / 248)
    expect(pointAt(ramp, -30).z).toBe(20)
    expect(pointAt(ramp, 500).z).toBe(80)
    const upper = attachTrack('s124', 1, endpoints(ramp)[1], 'upper')
    expect(upper.elevation).toBe(80)
    expect(connectedEndpoint([ramp, upper], ramp.id, 1)?.track.id).toBe(upper.id)
    const advanced = advanceTrain([ramp, upper], initial(ramp), 258)
    expect(advanced.position.trackId).toBe(upper.id)
    expect(sampleBehind([ramp, upper], advanced.position, 20)?.z).toBeCloseTo(20 + 60 * 238 / 248)
    expect(sampleBehind([ramp], { ...initial(ramp, -1), distance: 120 }, 20)?.slope).toBeCloseTo(-60 / 248)
  })

  it('rejects a visually overlapping connection on another level', () => {
    const upper: Track = { ...straight, id: 'upper', x: 248, elevation: 80 }
    expect(connectedEndpoint([straight, upper], straight.id, 1)).toBeNull()
    expect(advanceTrain([straight, upper], initial(straight), 270).stopped).toBe(true)
    expect(connectedEndpoint([straight, { ...upper, elevation: 0.9 }], straight.id, 1)).not.toBeNull()
    expect(connectedEndpoint([straight, { ...upper, elevation: 1.1 }], straight.id, 1)).toBeNull()
  })

  it('snaps dragged pieces with tangent alignment and retains their height', () => {
    const loose: Track = { ...straight, id: 'loose', kind: 'c282', x: 260, y: 6, angle: Math.PI / 18 }
    const snapped = snapTrack([straight, loose], loose)
    expect(snapped.x).toBeCloseTo(248)
    expect(snapped.y).toBeCloseTo(0)
    expect(snapped.angle).toBeCloseTo(0)
    expect(connectedEndpoint([straight, snapped], straight.id, 1)?.track.id).toBe(loose.id)
    const upper = { ...loose, elevation: 80 }
    expect(snapTrack([straight], upper)).toBe(upper)
  })

  it('avoids occupied and distant ports while dragging', () => {
    const joined = attachTrack('s248', 1, endpoints(straight)[1], 'joined')
    const loose = { ...straight, id: 'loose', x: 260, y: 4 }
    expect(snapTrack([straight, joined], loose)).toBe(loose)
    const far = { ...loose, x: 350 }
    expect(snapTrack([straight], far)).toBe(far)
  })

  it('creates a closed city layout using actual R381-30 catalog pieces', () => {
    const tracks = makeCityLayout()
    expect(tracks.filter((track) => TRACK_CATALOG.find((spec) => spec.kind === track.kind)?.radius === 381)).toHaveLength(12)
    expect(openEndpoints(tracks)).toHaveLength(0)
    expect(closedRouteLength(tracks, initial(tracks[0]))).toBeCloseTo(8 * 248 + 2 * Math.PI * 381)
  })

  it('creates an elevated circuit and a separate ground railway underneath it', () => {
    const tracks = makeViaductLayout()
    const upper = tracks.filter((track) => track.elevation === 80)
    const ground = tracks.filter((track) => !track.elevation)
    expect(upper).toHaveLength(16)
    expect(ground).toHaveLength(5)
    expect(openEndpoints(upper)).toHaveLength(0)
    expect(openEndpoints(ground)).toHaveLength(2)
    expect(closedRouteLength(tracks, initial(tracks[0]))).not.toBeNull()
    const journey = advanceTrain(tracks, initial(tracks[0]), 300)
    expect(sampleBehind(tracks, journey.position, 0)?.z).toBe(80)
  })
})

describe('turnouts and multiple rail routes', () => {
  it('exposes turnout physical ports and distinct straight and branch lengths', () => {
    const turnout = piece('turnout')
    const routes = pathsFor(turnout)
    expect(endpoints(turnout)).toHaveLength(3)
    expect(routes.map((route) => [route.startPort, route.endPort])).toEqual([[0, 1], [0, 2]])
    const spec = TRACK_CATALOG.find((item) => item.kind === turnout.kind)!
    expect(routes[1].length).toBeCloseTo(spec.branchRadius! * spec.branchAngle!)
    expect(routes[1].pointAt(routes[1].length).angle).toBeCloseTo(spec.branchAngle!)
  })

  it('routes trains to the selected turnout branch and reverses through its merge', () => {
    const turnout = { ...piece('turnout'), switchState: 'branch' as const }
    const leads = leadsFor(turnout)
    const tracks = [turnout, ...leads]
    const incoming = { ...initial(leads[0], -1), distance: 10 }
    const within = advanceTrain(tracks, incoming, 30)
    expect(within.position).toMatchObject({ trackId: turnout.id, route: 1, direction: 1, distance: 20 })
    expect(sampleBehind(tracks, within.position, 0)?.y).toBeGreaterThan(0)
    const outgoing = advanceTrain(tracks, incoming, 10 + trackLength(turnout, 1) + 20)
    expect(outgoing.position).toMatchObject({ trackId: leads[2].id, direction: 1, distance: expect.closeTo(20) })
    // Trailing entry follows the same set points as the chosen branch.
    const returning = advanceTrain(tracks, { ...initial(leads[2], -1), distance: 10 }, 30)
    expect(returning.position.trackId).toBe(turnout.id)
    expect(returning.position.route).toBe(1)
    expect(returning.position.direction).toBe(-1)
    const merged = advanceTrain(tracks, returning.position, trackLength(turnout, 1))
    expect(merged.position.trackId).toBe(leads[0].id)
    expect(merged.position.direction).toBe(1)
  })

  it('keeps the straight turnout route selected when its switch is straight', () => {
    const turnout = piece('turnout')
    const leads = leadsFor(turnout)
    const result = advanceTrain([turnout, ...leads], { ...initial(leads[0], -1), distance: 10 }, 10 + trackLength(turnout) + 20)
    expect(result.position.trackId).toBe(leads[1].id)
    expect(result.position.distance).toBeCloseTo(20)
    expect(result.position.route).toBeUndefined()
  })

  it.each(['straight', 'branch'] as const)('stops trailing entry through the inactive port with points set %s', (switchState) => {
    const turnout = { ...piece('turnout'), switchState }
    const leads = leadsFor(turnout)
    const inactivePort = switchState === 'branch' ? 1 : 2
    const blocked = advanceTrain([turnout, ...leads], { ...initial(leads[inactivePort], -1), distance: 10 }, 30)
    expect(blocked.stopped).toBe(true)
    expect(blocked.position.trackId).toBe(leads[inactivePort].id)
    expect(blocked.position.distance).toBe(0)
    // The rails remain physically joined even while the points block this route.
    expect(connectedEndpoint([turnout, ...leads], leads[inactivePort].id, 0)?.track.id).toBe(turnout.id)
  })

  it.each(['straight', 'branch'] as const)('keeps following bogies on the selected %s route after a trailing merge', (switchState) => {
    const turnout = { ...piece('turnout'), switchState }
    const leads = leadsFor(turnout)
    const route = switchState === 'branch' ? 1 : 0
    const outerPort = switchState === 'branch' ? 2 : 1
    const tracks = [turnout, ...leads]
    const result = advanceTrain(tracks, { ...initial(leads[outerPort], -1), distance: 20 }, 20 + trackLength(turnout, route) + 10)
    expect(result.stopped).toBe(false)
    expect(result.position.trackId).toBe(leads[0].id)
    const rear = sampleBehind(tracks, result.position, 40)!
    const expected = pointAt(turnout, 30, route)
    expect(rear.x).toBeCloseTo(expected.x)
    expect(rear.y).toBeCloseTo(expected.y)
  })

  it('traverses a crossing without switching to its intersecting rail route', () => {
    const crossing = piece('crossing')
    const leads = leadsFor(crossing)
    const tracks = [crossing, ...leads]
    expect(endpoints(crossing)).toHaveLength(4)
    for (const [start, end, route] of [[0, 1, 0], [2, 3, 1]]) {
      const within = advanceTrain(tracks, { ...initial(leads[start], -1), distance: 5 }, 25)
      expect(within.position.trackId).toBe(crossing.id)
      expect(within.position.route ?? 0).toBe(route)
      const through = advanceTrain(tracks, within.position, trackLength(crossing, route))
      expect(through.position.trackId).toBe(leads[end].id)
      expect(through.position.distance).toBeCloseTo(20)
    }
  })

  it('provides two parallel lanes and attaches both double-track ports', () => {
    const double = piece('doubleStraight')
    const lanes = pathsFor(double)
    expect(lanes).toHaveLength(2)
    expect(lanes[1].pointAt(100).y - lanes[0].pointAt(100).y).toBe(33)
    const next = attachTrack(double.kind, 1, endpoints(double)[1], 'next-double')
    expect(connectedEndpoint([double, next], double.id, 1)?.end).toBe(0)
    expect(connectedEndpoint([double, next], double.id, 3)?.end).toBe(2)
    const result = advanceTrain([double, next], { ...initial(double), route: 1 }, trackLength(double, 1) + 15)
    expect(result.position).toMatchObject({ trackId: next.id, route: 1, distance: expect.closeTo(15) })
  })

  it('uses the inner and outer double curve radii for both bend directions', () => {
    const double = piece('doubleCurve')
    const spec = TRACK_CATALOG.find((item) => item.kind === double.kind)!
    const clockwise = pathsFor(double)
    const counterclockwise = pathsFor({ ...double, bend: -1 })
    expect(clockwise[0].length).toBeCloseTo(spec.outerRadius! * spec.angle!)
    expect(clockwise[1].length).toBeCloseTo(spec.innerRadius! * spec.angle!)
    expect(counterclockwise[0].length).toBeCloseTo(spec.innerRadius! * spec.angle!)
    expect(counterclockwise[1].length).toBeCloseTo(spec.outerRadius! * spec.angle!)
    const a = clockwise[0].pointAt(clockwise[0].length)
    const b = clockwise[1].pointAt(clockwise[1].length)
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(33)
  })

  it('supports both nominal scissors crossovers with continuous endpoint tangents', () => {
    const scissors = { ...piece('scissors'), switchState: 'branch' as const }
    const routes = pathsFor(scissors)
    const leads = leadsFor(scissors)
    expect(routes).toHaveLength(4)
    expect(endpoints(scissors)).toHaveLength(4)
    for (const [start, end, route] of [[0, 3, 2], [2, 1, 3]]) {
      expect(routes[route].pointAt(0).angle).toBe(0)
      expect(routes[route].pointAt(routes[route].length).angle).toBe(0)
      const result = advanceTrain([scissors, ...leads], { ...initial(leads[start], -1), distance: 10 }, 10 + routes[route].length + 20)
      expect(result.position.trackId).toBe(leads[end].id)
      expect(result.position.distance).toBeCloseTo(20)
    }
  })
})
