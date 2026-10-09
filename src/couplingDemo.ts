import type { LayoutData } from './layout'
import type { TrainSnapshot } from './fleet'
import { solveConsistPoses } from './consistPose'
import { advanceTrain, attachTrack, endpoints } from './track'
import type { Endpoint, Track } from './track'
import type { CouplingTrainType } from './couplingTypes'
import { getTrainCarSpec, getTrainSpec } from './trains'

export const COUPLING_DEMO_NOSE_GAP = 80
const STRAIGHTS_PER_SIDE = 12
const STRAIGHT_LENGTH = 248
const RADIUS = 381
// Catalog C381 is a 30-degree section: six pieces form each half-circle.
const CURVES_PER_SIDE = 6
export interface CouplingDemoOptions {
  firstType?: CouplingTrainType
  firstCars?: number
  secondType?: CouplingTrainType
  secondCars?: number
}

/**
 * A closed, level practice railway for any two Shinkansen models and 3–11
 * cars in each set. Both trainsets start on one clear straight, first rear cab
 * facing second front cab, with their ordinary nose covers closed.
 * Straight sections grow beyond the default 2,976 mm approach when a longer
 * configuration needs more room, including maximum 11 + 11 formations.
 */
export function makeCouplingDemo(options: CouplingDemoOptions = {}): LayoutData {
  const firstType = options.firstType ?? 'e6', secondType = options.secondType ?? 'e5'
  const count = (value: number | undefined) => Number.isInteger(value) ? Math.max(3, Math.min(11, value!)) : 3
  const firstCars = count(options.firstCars), secondCars = count(options.secondCars)
  const span = (type: CouplingTrainType, cars: number) => Array.from({ length: cars }, (_, index) => getTrainCarSpec(type, index, cars).length).reduce((a, b) => a + b, 0) + (cars - 1) * getTrainSpec(type).carGap
  const straightsPerSide = Math.max(STRAIGHTS_PER_SIDE, Math.ceil((span(firstType, firstCars) + span(secondType, secondCars) + 400) / STRAIGHT_LENGTH))
  const tracks: Track[] = []
  let anchor: Endpoint = {
    position: { x: -straightsPerSide * STRAIGHT_LENGTH / 2, y: -RADIUS, z: 0 },
    angle: 0,
  }
  const side = [...Array<string>(straightsPerSide).fill('s248'), ...Array<string>(CURVES_PER_SIDE).fill('c381')]
  for (const kind of [...side, ...side]) {
    const track = attachTrack(kind, 1, anchor, `coupling-demo-${tracks.length + 1}`)
    tracks.push(track)
    anchor = endpoints(track)[1]
  }

  const e6Position = advanceTrain(tracks, {
    trackId: tracks[0].id, distance: 0, direction: 1, laps: 0,
  }, straightsPerSide * STRAIGHT_LENGTH - 176).position
  const e6: TrainSnapshot = {
    id: 'coupling-demo-e6', name: `${getTrainSpec(firstType).model} · First train`, type: firstType, carCount: firstCars,
    position: e6Position, cabForward: true, requestedSpeed: 65,
  }
  const tailOffset = solveConsistPoses(tracks, e6Position, true, e6.carCount, firstType).rearOffset
  const behind = advanceTrain(tracks, { ...e6Position, direction: -1 }, tailOffset + COUPLING_DEMO_NOSE_GAP).position
  const e5: TrainSnapshot = {
    id: 'coupling-demo-e5', name: `${getTrainSpec(secondType).model} · Second train`, type: secondType, carCount: secondCars,
    position: { ...behind, direction: behind.direction === 1 ? -1 : 1 },
    cabForward: true, requestedSpeed: 65,
  }
  return {
    version: 5, name: 'Shinkansen coupling practice', tracks, accessories: [],
    carCount: firstCars, trainType: firstType, trains: [e6, e5], selectedTrainId: e6.id,
    couplings: [],
  }
}
