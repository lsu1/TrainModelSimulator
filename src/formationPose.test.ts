import { describe, expect, it } from 'vitest'
import { solveConsistPoses } from './consistPose'
import type { CarPose, ConsistPoses, PoseVector } from './consistPose'
import { NOSE_COUPLER_PROFILES, NOSE_JOINT_LENGTH } from './couplingTypes'
import type { TrainSnapshot } from './fleet'
import { noseMount, solveCoupledFormation } from './formationPose'
import { makeKatoPlan02 } from './katoPlan'
import { advanceTrain, attachTrack, closedRouteLength, endpoints, pointAt, sampleBehind, samplePositionBehind } from './track'
import type { Track, TrainPosition } from './track'
import { getCouplingLinkLength, getTrainCarSpec } from './trains'

function distance(a: PoseVector, b: PoseVector): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

function snapshot(type: 'e5' | 'e6', count: number, position: TrainPosition | null): TrainSnapshot {
  return { id: type, name: type, type, carCount: count, position, cabForward: true, requestedSpeed: 65 }
}

function chain(count: number, kind = 's248'): Track[] {
  const tracks: Track[] = []
  let anchor = { position: { x: 0, y: 0, z: 0 }, angle: 0 }
  for (let index = 0; index < count; index += 1) {
    const track = attachTrack(kind, 1, anchor, `rail-${index}`)
    tracks.push(track)
    const end = endpoints(track)[1]
    anchor = { ...end, position: { ...end.position, z: end.position.z ?? 0 } }
  }
  return tracks
}

function checkMember(poses: ConsistPoses, train: TrainSnapshot): void {
  expect(poses.cars.every(Boolean)).toBe(true)
  expect(poses.couplings).toHaveLength(train.carCount - 1)
  for (const [index, possible] of poses.cars.entries()) {
    const car = possible!
    const spec = getTrainCarSpec(train.type, index, train.carCount)
    expect(distance(car.frontBogie, car.rearBogie)).toBeCloseTo(2 * spec.bogieOffset, 5)
    expect(distance(car.frontEnd, car.rearEnd)).toBeCloseTo(spec.length, 7)
    if (index) {
      expect(distance(poses.cars[index - 1]!.rearCoupling, car.frontCoupling))
        .toBeCloseTo(getCouplingLinkLength(train.type, index - 1, train.carCount), 5)
    }
  }
}

describe('shared mixed E6 + E5 nose-coupled poses', () => {
  it.each([[3, 3], [7, 10], [11, 11]])('preserves the original %i-car E6 and %i-car E5 models with one fixed nose joint', (e6Count, e5Count) => {
    const tracks = chain(24)
    const e6 = snapshot('e6', e6Count, { trackId: tracks[23].id, distance: 200, direction: 1, laps: 4 })
    const e5 = snapshot('e5', e5Count, null)
    const result = solveCoupledFormation(tracks, e6, e5)
    expect(result.complete).toBe(true)
    expect(result.e6).toEqual(solveConsistPoses(tracks, e6.position!, true, e6Count, 'e6'))
    checkMember(result.e6, e6)
    checkMember(result.e5, e5)
    expect(distance(result.joint!.e6Mount, result.joint!.e5Mount)).toBeCloseTo(NOSE_JOINT_LENGTH, 6)
    expect(distance(result.joint!.e6Mount, result.joint!.head)).toBeCloseTo(NOSE_COUPLER_PROFILES.e6.extensionLength, 6)
    expect(distance(result.joint!.e5Mount, result.joint!.head)).toBeCloseTo(NOSE_COUPLER_PROFILES.e5.extensionLength, 6)
    const originalTips = distance(result.e6.cars.at(-1)!.rearEnd, result.e5.cars[0]!.frontEnd)
    expect(originalTips).toBeCloseTo(17, 6)
    expect(result.e5Offset).toBeCloseTo(result.e6.rearOffset - 17, 6)
    expect(result.rearOffset).toBeCloseTo(result.e5Offset + result.e5.rearOffset, 6)
    expect(result.e5Position!.laps).toBe(4)
    expect(result.e5Position!.direction).toBe(1)
  })

  it('joining and splitting retain every original rail-bound car pose without moving either set', () => {
    const tracks = makeKatoPlan02().tracks
    const e6 = snapshot('e6', 7, { trackId: 'kato-plan02-main-23', distance: 160, direction: 1, laps: 0 })
    const e5 = snapshot('e5', 10, null)
    const connected = solveCoupledFormation(tracks, e6, e5)
    expect(connected.complete).toBe(true)
    const independentlyPlaced = { ...e5, position: connected.e5Position, cabForward: e6.cabForward }
    const reconnect = solveCoupledFormation(tracks, e6, independentlyPlaced)
    expect(reconnect).toEqual(connected)
    expect(solveConsistPoses(tracks, independentlyPlaced.position!, independentlyPlaced.cabForward, 10, 'e5')).toEqual(connected.e5)
    expect(solveConsistPoses(tracks, e6.position!, e6.cabForward, 7, 'e6')).toEqual(connected.e6)
  })

  it('reversal changes travel directions while preserving every physical car and nose connection', () => {
    const tracks = makeKatoPlan02().tracks
    const e6 = snapshot('e6', 7, { trackId: 'kato-plan02-main-23', distance: 170, direction: 1, laps: 2 })
    const e5 = snapshot('e5', 10, null)
    const before = structuredClone([e6, e5])
    const forward = solveCoupledFormation(tracks, e6, e5)
    const reversed = solveCoupledFormation(tracks, { ...e6, position: { ...e6.position!, direction: -1 }, cabForward: false }, e5)
    expect(reversed.complete).toBe(true)
    expect(reversed.e6).toEqual(forward.e6)
    expect(reversed.e5).toEqual(forward.e5)
    expect(reversed.joint).toEqual(forward.joint)
    expect(reversed.rearOffset).toBe(forward.rearOffset)
    expect(reversed.e5Position).toEqual({ ...forward.e5Position!, direction: forward.e5Position!.direction === 1 ? -1 : 1 })
    expect([e6, e5]).toEqual(before)
  })

  const journeys = [[3, 3], [7, 10], [11, 11]].flatMap(([e6Count, e5Count]) =>
    (['straight', 'branch'] as const).flatMap(switchState => ([1, -1] as const).map(direction => ({ e6Count, e5Count, switchState, direction }))))
  it.each(journeys)('$e6Count + $e5Count cars maintain fixed chords and connected noses through the complete $switchState KATO circuit in direction $direction', ({ e6Count, e5Count, switchState, direction }) => {
    const tracks = makeKatoPlan02().tracks.map(track => track.switchNumber ? { ...track, switchState } : track)
    let e6 = snapshot('e6', e6Count, { trackId: 'kato-plan02-main-7', distance: 30, direction, laps: 0 })
    const e5 = snapshot('e5', e5Count, null)
    const circumference = closedRouteLength(tracks, e6.position!)!
    const visited = new Set<string>()
    for (let traveled = 0; traveled <= circumference + 75; traveled += 75) {
      const result = solveCoupledFormation(tracks, e6, e5)
      expect(result.complete, `${e6.position!.trackId}:${e6.position!.distance}`).toBe(true)
      checkMember(result.e6, e6)
      checkMember(result.e5, e5)
      expect(distance(result.joint!.e6Mount, result.joint!.e5Mount)).toBeCloseTo(NOSE_JOINT_LENGTH, 6)
      const physical = { ...e6.position!, direction: e6.cabForward ? e6.position!.direction : e6.position!.direction === 1 ? -1 as const : 1 as const }
      const cursor = samplePositionBehind(tracks, physical, result.e5Offset)!
      expect(result.e5Position!.trackId).toBe(cursor.trackId)
      expect(result.e5Position!.route ?? 0).toBe(cursor.route ?? 0)
      expect(result.e5Position!.distance).toBe(cursor.distance)
      visited.add(e6.position!.trackId)
      e6 = { ...e6, position: advanceTrain(tracks, e6.position!, 75).position }
    }
    expect(visited.has('kato-plan02-main-20')).toBe(true)
    expect(visited.has('kato-plan02-main-34')).toBe(true)
    expect(visited.has('kato-plan02-main-27')).toBe(true)
    expect(visited.has('kato-plan02-passing-3')).toBe(switchState === 'branch')
  })

  it('moves continuously at the former combined curve and grade transition', () => {
    const tracks = makeKatoPlan02().tracks
    let e6 = snapshot('e6', 3, { trackId: 'kato-plan02-main-20', distance: 30, direction: 1, laps: 0 })
    const e5 = snapshot('e5', 3, null)
    let previous: CarPose[] | null = null
    for (let step = 0; step < 100; step += 1) {
      const result = solveCoupledFormation(tracks, e6, e5)
      expect(result.complete).toBe(true)
      const cars = [...result.e6.cars, ...result.e5.cars] as CarPose[]
      if (previous) for (const [index, car] of cars.entries()) expect(distance(car.center, previous[index].center)).toBeLessThan(2)
      previous = cars
      e6 = { ...e6, position: advanceTrain(tracks, e6.position!, 1).position }
    }
  })

  it('refuses an incomplete trailing set at an open end rather than extrapolating or stretching its joint', () => {
    const tracks = chain(3)
    const e6 = snapshot('e6', 3, { trackId: tracks[2].id, distance: 180, direction: 1, laps: 0 })
    const e5 = snapshot('e5', 11, null)
    const result = solveCoupledFormation(tracks, e6, e5)
    expect(result.e6.cars.every(Boolean)).toBe(true)
    expect(result.complete).toBe(false)
    expect(result.e5.cars.some(car => car === null)).toBe(true)
    expect(distance(result.joint!.e6Mount, result.joint!.e5Mount)).toBeCloseTo(NOSE_JOINT_LENGTH, 6)
  })

  it('places the mount in pitched body coordinates, including the horizontal component of its height', () => {
    const tracks = makeKatoPlan02().tracks
    const e6 = snapshot('e6', 3, { trackId: 'kato-plan02-main-23', distance: 160, direction: 1, laps: 0 })
    const result = solveCoupledFormation(tracks, e6, snapshot('e5', 3, null))
    const car = result.e6.cars.at(-1)!
    const mount = noseMount(car, 'e6')
    const delta = { x: mount.x - car.rearEnd.x, y: mount.y - car.rearEnd.y, z: mount.z - car.rearEnd.z }
    expect(delta.x * car.direction.x + delta.y * car.direction.y + delta.z * car.direction.z).toBeCloseTo(18, 7)
    expect(distance(car.rearEnd, mount)).toBeCloseTo(Math.hypot(18, 9.5), 7)
  })
})

describe('exact backwards rail cursors', () => {
  it('retains the selected double-track lane even when another lane or overpass shares nearby world coordinates', () => {
    const tracks = chain(5, 'ds248')
    const high = tracks.map(track => ({ ...track, id: `${track.id}-high`, elevation: 60 }))
    const position: TrainPosition = { trackId: tracks[4].id, distance: 160, direction: 1, route: 1, laps: 7 }
    const all = [...tracks, ...high]
    const cursor = samplePositionBehind(all, position, 400)!
    expect(cursor.trackId).toBe(tracks[3].id)
    expect(cursor.route).toBe(1)
    expect(cursor.distance).toBeCloseTo(8, 7)
    expect(cursor.direction).toBe(1)
    expect(cursor.laps).toBe(7)
    const sampled = sampleBehind(all, position, 400)!
    expect(sampled).toEqual(pointAt(tracks[3], cursor.distance, 1))
    expect(sampled.z).toBe(0)
  })

  it('accepts an exact open endpoint but never manufactures a rail cursor beyond it', () => {
    const tracks = chain(1)
    const position: TrainPosition = { trackId: tracks[0].id, distance: 100, direction: 1, laps: 0 }
    expect(samplePositionBehind(tracks, position, 100)).toEqual({ ...position, distance: 0 })
    expect(samplePositionBehind(tracks, position, 100.001)).toBeNull()
  })
})
