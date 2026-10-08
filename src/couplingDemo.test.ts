import { describe, expect, it } from 'vitest'
import { COUPLING_DEMO_NOSE_GAP, makeCouplingDemo } from './couplingDemo'
import { solveConsistPoses } from './consistPose'
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
})
