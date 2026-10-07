import { describe, expect, it } from 'vitest'
import { KATO_CATALOG } from './catalog'
import { auditClearances } from './clearance'
import { solveConsistPoses } from './consistPose'
import { auditEngineering } from './engineering'
import { makeKatoPlan02 } from './katoPlan'
import { parseLayout } from './layout'
import { advanceTrain, closedRouteLength, connectedEndpoint, endpoints, openEndpoints, pathsFor, pointAt, SNAP_ANGLE, SNAP_DISTANCE, trackLength } from './track'
import type { Track, TrainPosition } from './track'

const difference = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))
const main = (tracks: Track[], number: number) => tracks.find(track => track.id === `kato-plan02-main-${number}`)!

describe('official KATO plan 02-1A', () => {
  it('retains the complete M1 + V1 + V2 + extra R315 inventory and source identity', () => {
    const layout = makeKatoPlan02()
    const inventory: Record<string, number> = {}
    for (const track of layout.tracks) inventory[track.kind] = (inventory[track.kind] ?? 0) + 1
    expect(inventory).toEqual({
      s248: 14, c315: 12, t6l: 1, t6r: 1, c718: 2, s64: 2,
      s62: 1, 's62-feeder': 1, s124: 1, 's124-rerailer': 1,
      v315: 8, v248: 4, v124: 2, 'b248-red': 1,
    })
    expect(layout.tracks).toHaveLength(51)
    expect(layout).toMatchObject({ name: 'KATO M1 + V1 + V2', sourcePlan: 'kato-plan02-1a', carCount: 3 })
    expect(layout.tracks.filter(track => track.switchNumber).map(track => [track.kind, track.switchNumber])).toEqual([['t6l', 1], ['t6r', 2]])
    expect(parseLayout(JSON.parse(JSON.stringify(layout)))).toEqual(layout)
  })

  it('places all sixteen illustrated piers and both approach spacers on the table', () => {
    const layout = makeKatoPlan02()
    const inventory: Record<string, number> = {}
    for (const support of layout.accessories) inventory[support.kind] = (inventory[support.kind] ?? 0) + 1
    expect(inventory).toEqual({
      'a-pier-incline-s': 2,
      'a-pier-incline-1': 2, 'a-pier-incline-2': 2,
      'a-pier-incline-3': 2, 'a-pier-incline-4': 2,
      'a-pier-incline-5': 6, 'a-incline-spacer': 2,
    })
    expect(layout.accessories.every(support => support.elevation === 0)).toBe(true)
    const assumedHeights: Record<string, number> = {
      'a-incline-spacer': 5, 'a-pier-incline-s': 10,
      'a-pier-incline-1': 25, 'a-pier-incline-2': 35,
      'a-pier-incline-3': 45, 'a-pier-incline-4': 55, 'a-pier-incline-5': 60,
    }
    for (const support of layout.accessories) {
      const contact = layout.tracks.flatMap(endpoints).find(endpoint =>
        Math.hypot(endpoint.position.x - support.x, endpoint.position.y - support.y) < 1e-6
        && Math.abs((endpoint.position.z ?? 0) - assumedHeights[support.kind]) < 1e-6)
      expect(contact, support.id).toBeDefined()
    }
  })

  it('joins every port within the existing strict tolerances without stretching purchased straights', () => {
    const layout = makeKatoPlan02()
    expect(openEndpoints(layout.tracks)).toHaveLength(0)
    let greatestYaw = 0
    for (const track of layout.tracks) {
      const spec = KATO_CATALOG.find(item => item.kind === track.kind)!
      for (const [port, endpoint] of endpoints(track).entries()) {
        const connection = connectedEndpoint(layout.tracks, track.id, port)!
        const peer = endpoints(connection.track)[connection.end]
        const positionGap = Math.hypot(endpoint.position.x - peer.position.x, endpoint.position.y - peer.position.y)
        expect(positionGap).toBeLessThanOrEqual(SNAP_DISTANCE)
        expect(positionGap).toBeLessThan(1e-6)
        expect(Math.abs((endpoint.position.z ?? 0) - (peer.position.z ?? 0))).toBeLessThan(1e-6)
        greatestYaw = Math.max(greatestYaw, difference(endpoint.angle, peer.angle + Math.PI))
        expect(difference(endpoint.angle, peer.angle + Math.PI)).toBeLessThanOrEqual(SNAP_ANGLE)
      }
      if (spec.shape === 'straight') {
        const [start, end] = endpoints(track)
        expect(Math.hypot(end.position.x - start.position.x, end.position.y - start.position.y,
          (end.position.z ?? 0) - (start.position.z ?? 0))).toBeCloseTo(spec.length, 7)
      }
    }
    expect(greatestYaw * 180 / Math.PI).toBeLessThanOrEqual(.245001)
    expect(auditEngineering(layout).filter(issue => issue.severity === 'error')).toEqual([])
    expect(auditEngineering(layout).some(issue => issue.code === 'support-datum-unconfirmed')).toBe(true)
    expect(auditEngineering(layout).some(issue => issue.code === 'graded-special-geometry')).toBe(true)
    expect(auditClearances(layout).filter(issue => issue.severity === 'error')).toEqual([])
  })

  it.each(['straight', 'branch'] as const)('runs a closed three-car circuit through the %s turnout route', (state) => {
    const layout = makeKatoPlan02()
    const tracks = layout.tracks.map(track => track.switchNumber ? { ...track, switchState: state } : track)
    const start: TrainPosition = { trackId: main(tracks, 7).id, distance: 30, direction: 1, laps: 0 }
    const circumference = closedRouteLength(tracks, start)
    expect(circumference).not.toBeNull()
    const traveled = advanceTrain(tracks, start, circumference! * 3 + 20)
    expect(traveled.stopped).toBe(false)
    expect(traveled.position.trackId).toBe(start.trackId)
    expect(traveled.position.distance).toBeCloseTo(50, 6)

    const visited = new Set<string>()
    let position = start
    for (let distance = 0; distance < circumference! + 80; distance += 80) {
      visited.add(position.trackId)
      expect(solveConsistPoses(tracks, position, true, 3).cars.every(Boolean)).toBe(true)
      const next = advanceTrain(tracks, position, 80)
      expect(next.stopped).toBe(false)
      position = next.position
    }
    expect(visited.has(main(tracks, 27).id)).toBe(true)
    expect(visited.has('kato-plan02-passing-3')).toBe(state === 'branch')
    expect(visited.has(main(tracks, 3).id)).toBe(state === 'straight')
  })

  it('crosses the ground route inside the elevated red bridge span and tilts car bodies on the approach', () => {
    const layout = makeKatoPlan02()
    const bridge = main(layout.tracks, 27)
    const underpass = main(layout.tracks, 15)
    const a = pointAt(bridge, 0), b = pointAt(bridge, trackLength(bridge))
    const c = pointAt(underpass, 0), d = pointAt(underpass, trackLength(underpass))
    const ux = b.x - a.x, uy = b.y - a.y, vx = d.x - c.x, vy = d.y - c.y
    const determinant = ux * vy - uy * vx
    const alongBridge = ((c.x - a.x) * vy - (c.y - a.y) * vx) / determinant
    const alongGround = ((c.x - a.x) * uy - (c.y - a.y) * ux) / determinant
    expect(alongBridge).toBeGreaterThan(.2)
    expect(alongBridge).toBeLessThan(.8)
    expect(alongGround).toBeGreaterThan(0)
    expect(alongGround).toBeLessThan(1)
    expect(pointAt(bridge, trackLength(bridge) * alongBridge).z).toBe(60)
    expect(pointAt(underpass, trackLength(underpass) * alongGround).z).toBe(0)
    const crossing = pointAt(bridge, trackLength(bridge) * alongBridge)
    expect(layout.accessories.every(support => Math.hypot(support.x - crossing.x, support.y - crossing.y) > 70)).toBe(true)

    const approach = main(layout.tracks, 22)
    const poses = solveConsistPoses(layout.tracks, { trackId: approach.id, distance: 150, direction: 1, laps: 0 }, true, 3)
    expect(poses.cars.every(Boolean)).toBe(true)
    expect(poses.cars[0]!.pitch).toBeGreaterThan(0)
    expect(poses.cars[0]!.frontBogie.z).toBeGreaterThan(poses.cars[0]!.rearBogie.z)
    expect(Math.max(...layout.tracks.flatMap(track => pathsFor(track).map(path => path.pointAt(path.length).z)))).toBe(60)
  })
})
