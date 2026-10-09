import { describe, expect, it } from 'vitest'
import { COUPLING_DEMO_NOSE_GAP, makeCouplingDemo } from './couplingDemo'
import { solveConsistPoses } from './consistPose'
import { couplingEligibility } from './couplingMotion'
import type { CouplingTrainType } from './couplingTypes'
import { solveCoupledFormation } from './formationPose'
import { physicalTrainFootprintsConflict, trainFootprint } from './trainSafety'
import { createLayout, parseLayout } from './layout'
import { restoreFleet } from './fleet'
import { advanceTrain, closedRouteLength, openEndpoints, trackLength } from './track'
import { validateTrainPlacement } from './trainPlacement'
import { getTrainSpec } from './trains'

describe('Shinkansen nose-coupling practice railway', () => {
  it('uses real-length S248 and R381 pieces in one closed, level railway', () => {
    const layout = makeCouplingDemo()
    expect(openEndpoints(layout.tracks)).toEqual([])
    expect(layout.tracks.filter(track => track.kind === 's248')).toHaveLength(24)
    expect(layout.tracks.filter(track => track.kind === 'c381')).toHaveLength(12)
    expect(layout.tracks.every(track => (track.elevation ?? 0) === 0 && (track.endElevation ?? 0) === 0)).toBe(true)
    expect(layout.tracks.slice(0, 12).reduce((length, track) => length + trackLength(track), 0)).toBe(2_976)
    expect(closedRouteLength(layout.tracks, layout.trains![0].position!)).toBeCloseTo(5_952 + 2 * Math.PI * 381)
    expect(createLayout('coupling-demo')).toEqual(parseLayout(layout))
  })

  it('restores two stopped, completely supported shortened trainsets with clear compatible noses', () => {
    const layout = makeCouplingDemo()
    const [e6, e5] = restoreFleet(layout)
    expect(layout.selectedTrainId).toBe(e6.id)
    expect(layout.couplings).toEqual([])
    expect([e6, e5].map(train => train.type)).toEqual(['e6', 'e5'])
    expect([e6, e5].every(train => train.carCount === 3 && !train.running && train.actualSpeed === 0 && !train.noseCoupling)).toBe(true)
    for (const train of [e6, e5]) expect(validateTrainPlacement(layout.tracks, train, [e6, e5])).toEqual({ allowed: true })
    const e6Poses = solveConsistPoses(layout.tracks, e6.position!, e6.cabForward, e6.carCount, e6.type)
    const e5Poses = solveConsistPoses(layout.tracks, e5.position!, e5.cabForward, e5.carCount, e5.type)
    expect(e6Poses.cars.every(Boolean) && e5Poses.cars.every(Boolean)).toBe(true)
    const rear = e6Poses.cars[2]!.rearEnd, front = e5Poses.cars[0]!.frontEnd
    expect(rear.x - front.x).toBeCloseTo(COUPLING_DEMO_NOSE_GAP, 6)
    expect(rear.y).toBeCloseTo(front.y, 6)
    expect(rear.z).toBeCloseTo(front.z, 6)
    expect(e6Poses.cars.every(car => car!.pitch === 0)).toBe(true)
    expect(e5Poses.cars.every(car => car!.pitch === 0)).toBe(true)
  })

  it('has enough straight approach room for both authentic ten- and seven-car trainsets', () => {
    const layout = makeCouplingDemo()
    const [e6, originalE5] = restoreFleet(layout)
    e6.carCount = getTrainSpec('e6').fullFormation
    const e6Poses = solveConsistPoses(layout.tracks, e6.position!, true, e6.carCount, 'e6')
    const back = advanceTrain(layout.tracks, { ...e6.position!, direction: -1 }, e6Poses.rearOffset + COUPLING_DEMO_NOSE_GAP).position
    const e5 = { ...originalE5, carCount: getTrainSpec('e5').fullFormation, position: { ...back, direction: back.direction === 1 ? -1 as const : 1 as const } }
    expect(validateTrainPlacement(layout.tracks, e6, [e6, e5])).toEqual({ allowed: true })
    expect(validateTrainPlacement(layout.tracks, e5, [e6, e5])).toEqual({ allowed: true })
    const e5Poses = solveConsistPoses(layout.tracks, e5.position, true, e5.carCount, 'e5')
    expect(e6Poses.cars).toHaveLength(7)
    expect(e5Poses.cars).toHaveLength(10)
    expect([...e6Poses.cars, ...e5Poses.cars].every(car => car && Math.abs(car.center.angle) < 1e-8 && car.pitch === 0)).toBe(true)
    expect(e5Poses.cars[9]!.rearEnd.x).toBeGreaterThan(layout.tracks[0].x)
  })

  const configured: { firstType: CouplingTrainType; firstCars: number; secondType: CouplingTrainType; secondCars: number }[] = [
    { firstType: 'e6', firstCars: 7, secondType: 'e5', secondCars: 10 },
    { firstType: 'e7', firstCars: 11, secondType: 'e7', secondCars: 11 },
    { firstType: 'e5', firstCars: 11, secondType: 'e7', secondCars: 11 },
  ]
  it.each(configured)('places $firstCars-car $firstType and $secondCars-car $secondType on a clear straight, ready to couple in a closed loop', options => {
    const layout = makeCouplingDemo(options)
    const roundTrip = parseLayout(JSON.parse(JSON.stringify(layout)))
    const fleet = restoreFleet(roundTrip)
    const [leader, follower] = fleet
    expect(fleet.map(train => [train.type, train.carCount])).toEqual([
      [options.firstType, options.firstCars], [options.secondType, options.secondCars],
    ])
    expect(fleet.every(train => !train.running && train.actualSpeed === 0 && train.position)).toBe(true)
    expect(openEndpoints(layout.tracks)).toEqual([])
    expect(layout.tracks.filter(track => track.kind === 'c381')).toHaveLength(12)
    expect(closedRouteLength(layout.tracks, leader.position!)).toBeGreaterThan(6_000)
    for (const train of fleet) expect(validateTrainPlacement(layout.tracks, train, fleet)).toEqual({ allowed: true })
    expect(physicalTrainFootprintsConflict(trainFootprint(layout.tracks, leader), trainFootprint(layout.tracks, follower))).toBe(false)
    const first = solveConsistPoses(layout.tracks, leader.position!, leader.cabForward, leader.carCount, leader.type)
    const second = solveConsistPoses(layout.tracks, follower.position!, follower.cabForward, follower.carCount, follower.type)
    expect(first.cars).toHaveLength(options.firstCars)
    expect(second.cars).toHaveLength(options.secondCars)
    expect([...first.cars, ...second.cars].every(car => car && Math.abs(car.center.angle) < 1e-8 && car.pitch === 0)).toBe(true)
    expect(first.cars.at(-1)!.rearEnd.x - second.cars[0]!.frontEnd.x).toBeCloseTo(COUPLING_DEMO_NOSE_GAP, 6)
    expect(second.cars.at(-1)!.rearEnd.x).toBeGreaterThan(layout.tracks[0].x)
    const eligibility = couplingEligibility(layout.tracks, fleet, follower.id, leader.id)
    expect(eligibility.allowed, eligibility.reason).toBe(true)
    const pair = eligibility.pair!
    const reference = fleet.find(train => train.id === pair.e6Id)!
    const partner = fleet.find(train => train.id === pair.e5Id)!
    const formation = solveCoupledFormation(layout.tracks, reference, partner, pair)
    expect(formation.complete).toBe(true)
    expect([...formation.e6.cars, ...formation.e5.cars].every(car => car && Math.abs(car.center.angle) < 1e-8 && car.pitch === 0)).toBe(true)
    expect(formation.e6.cars.length + formation.e5.cars.length).toBe(options.firstCars + options.secondCars)
    if (options.firstCars === 11 && options.secondCars === 11) expect(layout.tracks.filter(track => track.kind === 's248').length).toBeGreaterThan(24)
  })
})
