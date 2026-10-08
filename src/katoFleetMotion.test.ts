import { describe, expect, it } from 'vitest'
import type { TrainRuntime } from './fleet'
import { stepFleet } from './fleetMotion'
import { makeKatoPlan02 } from './katoPlan'
import { advanceTrain, closedRouteLength } from './track'
import { getTrainSpec } from './trains'
import type { TrainType } from './trains'

const formations: { type: TrainType; carCount: number }[] = [
  { type: 'e235', carCount: 3 }, { type: 'e235', carCount: 4 },
  { type: 'e5', carCount: 11 }, { type: 'e6', carCount: 7 }, { type: 'e7', carCount: 11 },
]
const journeys = formations.flatMap(formation => (['straight', 'branch'] as const).flatMap(switchState =>
  ([1, -1] as const).map(direction => ({ ...formation, switchState, direction }))))

describe('KATO plan 02-1A fleet safety through complete graded circuits', () => {
  it.each(journeys)('$type $carCount cars completes the $switchState circuit in direction $direction', ({ type, carCount, switchState, direction }) => {
    const layout = makeKatoPlan02()
    const tracks = layout.tracks.map(track => track.switchNumber ? { ...track, switchState } : track)
    const max = getTrainSpec(type).maxServiceSpeed
    let train: TrainRuntime = {
      id: 'tour', name: 'Preset tour', type, carCount, cabForward: true,
      requestedSpeed: max, actualSpeed: max, running: true, status: 'moving', lapProgress: 0,
      position: { trackId: 'kato-plan02-main-7', distance: 30, route: 0, direction, laps: 0 },
    }
    const circumference = closedRouteLength(tracks, train.position!)!
    expect(circumference).toBeGreaterThan(8000)
    const distancePerFrame = max / 3.6 * 1000 / getTrainSpec(type).scale * .1
    const visited = new Set<string>()
    for (let distance = 0; distance < circumference + distancePerFrame; distance += distancePerFrame) {
      const expected = advanceTrain(tracks, train.position!, distancePerFrame)
      train = stepFleet(tracks, [train], .1)[0]
      expect(train.running, `${train.position!.trackId} at ${train.position!.distance}: ${train.stopReason}`).toBe(true)
      expect(train.actualSpeed).toBe(max)
      expect(train.position!.trackId).toBe(expected.position.trackId)
      expect(train.position!.distance).toBeCloseTo(expected.position.distance, 6)
      visited.add(train.position!.trackId)
    }
    expect(train.position!.laps).toBeGreaterThanOrEqual(1)
    expect(visited.has('kato-plan02-main-20')).toBe(true)
    expect(visited.has('kato-plan02-main-34')).toBe(true)
    expect(visited.has('kato-plan02-main-27')).toBe(true)
    expect(visited.has('kato-plan02-passing-3')).toBe(switchState === 'branch')
  })
})
