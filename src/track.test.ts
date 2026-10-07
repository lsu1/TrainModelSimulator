import { describe, expect, it } from 'vitest'
import {
  TRACK_CATALOG,
  advanceTrain,
  attachTrack,
  closedRouteLength,
  connectedEndpoint,
  endpoints,
  makeStarterLayout,
  openEndpoints,
  pointAt,
  sampleBehind,
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
  it('uses Kato straight lengths and 45° curve arc lengths', () => {
    expect(trackLength('s248')).toBe(248)
    expect(trackLength('s124')).toBe(124)
    expect(trackLength('s62')).toBe(62)
    for (const spec of TRACK_CATALOG.filter((piece) => piece.radius !== undefined)) {
      expect(spec.length).toBeCloseTo(spec.radius! * Math.PI / 4)
      expect(spec.angle).toBe(Math.PI / 4)
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
