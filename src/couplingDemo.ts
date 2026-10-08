import type { LayoutData } from './layout'
import type { TrainSnapshot } from './fleet'
import { solveConsistPoses } from './consistPose'
import { advanceTrain, attachTrack, endpoints } from './track'
import type { Endpoint, Track } from './track'

export const COUPLING_DEMO_NOSE_GAP = 80
const STRAIGHTS_PER_SIDE = 12
const STRAIGHT_LENGTH = 248
const RADIUS = 381
// Catalog C381 is a 30-degree section: six pieces form each half-circle.
const CURVES_PER_SIDE = 6

/**
 * A level practice railway with a 2,976 mm approach on each side. The two
 * shortened trainsets begin nose-to-nose at their compatible E6 rear/E5 front
 * ends, while retaining their ordinary closed covers until coupling starts.
 * The approach also accommodates the normal 7-car E6 plus 10-car E5 lengths.
 */
export function makeCouplingDemo(): LayoutData {
  const tracks: Track[] = []
  let anchor: Endpoint = {
    position: { x: -STRAIGHTS_PER_SIDE * STRAIGHT_LENGTH / 2, y: -RADIUS, z: 0 },
    angle: 0,
  }
  const side = [...Array<string>(STRAIGHTS_PER_SIDE).fill('s248'), ...Array<string>(CURVES_PER_SIDE).fill('c381')]
  for (const kind of [...side, ...side]) {
    const track = attachTrack(kind, 1, anchor, `coupling-demo-${tracks.length + 1}`)
    tracks.push(track)
    anchor = endpoints(track)[1]
  }

  const e6Position = advanceTrain(tracks, {
    trackId: tracks[0].id, distance: 0, direction: 1, laps: 0,
  }, 2_800).position
  const e6: TrainSnapshot = {
    id: 'coupling-demo-e6', name: 'Komachi · E6', type: 'e6', carCount: 3,
    position: e6Position, cabForward: true, requestedSpeed: 65,
  }
  const tailOffset = solveConsistPoses(tracks, e6Position, true, e6.carCount, 'e6').rearOffset
  const behind = advanceTrain(tracks, { ...e6Position, direction: -1 }, tailOffset + COUPLING_DEMO_NOSE_GAP).position
  const e5: TrainSnapshot = {
    id: 'coupling-demo-e5', name: 'Hayabusa · E5', type: 'e5', carCount: 3,
    position: { ...behind, direction: behind.direction === 1 ? -1 : 1 },
    cabForward: true, requestedSpeed: 65,
  }
  return {
    version: 4, name: 'Shinkansen coupling practice', tracks, accessories: [],
    carCount: 3, trainType: 'e6', trains: [e6, e5], selectedTrainId: e6.id,
    couplings: [],
  }
}
