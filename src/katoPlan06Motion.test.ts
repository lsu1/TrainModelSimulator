import { describe, expect, it } from 'vitest'
import { solveConsistPoses } from './consistPose'
import type { TrainRuntime } from './fleet'
import { stepFleet } from './fleetMotion'
import { makeKatoPlan06 } from './katoPlan06'
import { advanceTrain, closedRouteLength, pointAt } from './track'
import type { Track, TrainPosition } from './track'
import { getTrainSpec } from './trains'
import type { TrainType } from './trains'

const id = (sourceIndex: number) => `kato06-${String(sourceIndex).padStart(3, '0')}`
const switched = (tracks: Track[], branches: readonly number[]) => tracks.map(track =>
  track.switchNumber ? { ...track, switchState: branches.includes(Number(track.id.slice(-3))) ? 'branch' as const : 'straight' as const } : track)

const circuits = [
  { name: 'inner conventional line', start: 19, lane: 0, height: 0, branches: [] },
  { name: 'outer conventional line', start: 0, lane: 0, height: 0, branches: [162] },
  { name: 'diagonal local line', start: 77, lane: 0, height: 0, branches: [223, 149, 20, 216, 217, 93] },
  { name: 'elevated lane 1 main', start: 274, lane: 0, height: 60, branches: [] },
  { name: 'elevated lane 2 main', start: 274, lane: 1, height: 60, branches: [] },
  { name: 'elevated lane 1 platform branch', start: 274, lane: 0, height: 60, branches: [232, 237, 243, 262] },
  { name: 'elevated lane 2 platform branch', start: 274, lane: 1, height: 60, branches: [232, 237, 243, 262] },
] as const
const formations: { type: TrainType; carCount: number }[] = [
  { type: 'e235', carCount: 11 }, { type: 'e5', carCount: 11 },
  { type: 'e6', carCount: 7 }, { type: 'e7', carCount: 11 },
]
const journeys = circuits.flatMap(circuit => formations.flatMap(formation =>
  ([1, -1] as const).map(direction => ({ ...circuit, ...formation, direction }))))

describe('KATO plan 06-15 existing rolling stock on complete circuits', () => {
  it.each(journeys)('$type $carCount cars completes $name in direction $direction',
    ({ type, carCount, name, start, lane, height, branches, direction }) => {
      const tracks = switched(makeKatoPlan06().tracks, branches)
      const speed = getTrainSpec(type).maxServiceSpeed
      let train: TrainRuntime = {
        id: 'circuit-test', name: `${type} ${name}`, type, carCount, cabForward: true,
        requestedSpeed: speed, actualSpeed: speed, running: true, status: 'moving', lapProgress: 0,
        position: { trackId: id(start), distance: 30, route: lane, direction, laps: 0 },
      }
      const circumference = closedRouteLength(tracks, train.position!)
      expect(circumference, `${name} must be a complete operational circuit`).not.toBeNull()
      expect(circumference).toBeGreaterThan(6000)
      const perFrame = speed / 3.6 * 1000 / getTrainSpec(type).scale * .1
      const visited = new Set<string>()
      for (let traveled = 0; traveled < circumference! + perFrame; traveled += perFrame) {
        const expected = advanceTrain(tracks, train.position!, perFrame)
        train = stepFleet(tracks, [train], .1)[0]
        expect(train.running, `${train.position?.trackId}: ${train.stopReason}`).toBe(true)
        expect(train.actualSpeed).toBe(speed)
        expect(train.position!.trackId).toBe(expected.position.trackId)
        expect(train.position!.distance).toBeCloseTo(expected.position.distance, 6)
        const current = tracks.find(track => track.id === train.position!.trackId)!
        expect(pointAt(current, train.position!.distance, train.position!.route).z).toBe(height)
        visited.add(current.id)
      }
      expect(train.position!.laps).toBeGreaterThanOrEqual(1)
      expect(visited.size).toBeGreaterThan(35)
      const poses = solveConsistPoses(tracks, train.position!, true, carCount, type)
      expect(poses.cars.every(Boolean)).toBe(true)
      if (height === 60) {
        expect([...visited].some(trackId => tracks.find(track => track.id === trackId)!.kind === 'db248-blue')).toBe(true)
        // Station branch circuits use the single-track platform loops; the
        // main circuits keep those same turnouts on their straight routes.
        expect([...visited].some(trackId => tracks.find(track => track.id === trackId)!.kind === 's248-pc'))
          .toBe(branches.length > 0)
      }
    }, 60_000)

  it.each([
    { target: 197, direction: 1 as const, branches: [223, 149, 72] },
    { target: 198, direction: 1 as const, branches: [223, 149, 72, 75] },
    { target: 204, direction: -1 as const, branches: [93, 217, 216, 20, 149, 184] },
    { target: 205, direction: -1 as const, branches: [93, 217, 216, 20, 149] },
  ])('routes from the conventional network to yard buffer $target without a fabricated join', ({ target, direction, branches }) => {
    const tracks = switched(makeKatoPlan06().tracks, branches)
    const start: TrainPosition = { trackId: id(77), distance: 30, direction, route: 0, laps: 0 }
    expect(closedRouteLength(tracks, start)).toBeNull()
    let position = start
    let stopped = false
    for (let distance = 0; distance < 25_000 && !stopped; distance += 20) {
      const result = advanceTrain(tracks, position, 20)
      position = result.position
      stopped = result.stopped
    }
    expect(stopped).toBe(true)
    expect(position.trackId).toBe(id(target))
    expect(tracks.find(track => track.id === position.trackId)!.kind).toMatch(/buffer/)
  })

  it('runs the preset Yamanote and two independent Shinkansen trains simultaneously on their own levels', () => {
    const layout = makeKatoPlan06()
    let fleet: TrainRuntime[] = layout.trains!.map(train => ({
      ...train, requestedSpeed: 90, actualSpeed: 90, running: true, status: 'moving', lapProgress: 0,
    }))
    const circumferences = fleet.map(train => closedRouteLength(layout.tracks, train.position!)!)
    expect(circumferences.every(length => length > 6000)).toBe(true)
    const frames = Math.ceil(Math.max(...circumferences.map((length, index) =>
      length / (90 / 3.6 * 1000 / getTrainSpec(fleet[index].type).scale * .1)))) + 1
    for (let frame = 0; frame < frames; frame++) {
      fleet = stepFleet(layout.tracks, fleet, .1)
      for (const train of fleet) {
        expect(train.running, `${train.name}: ${train.stopReason}`).toBe(true)
        expect(train.actualSpeed).toBe(90)
        const track = layout.tracks.find(value => value.id === train.position!.trackId)!
        expect(pointAt(track, train.position!.distance, train.position!.route).z).toBe(train.type === 'e235' ? 0 : 60)
      }
    }
    expect(fleet.every(train => train.position!.laps >= 1)).toBe(true)
    expect(fleet.map(train => train.id)).toEqual(layout.trains!.map(train => train.id))
  }, 60_000)
})
