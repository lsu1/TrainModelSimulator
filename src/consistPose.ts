import { sampleBehind, withTrackGraph } from './track'
import type { Track, TrackPoint, TrainPosition } from './track'
import { CAR_SPACING } from './trainModel'
import { getCouplingLinkLength, getTrainCarSpec } from './trains'
import type { TrainType } from './trains'

/** Model millimetres. Coupling pivots follow the bogies, as on an N-scale mechanism. */
export const BOGIE_OFFSET = 43.7
export const COUPLING_HEIGHT = 3.45
export const COUPLING_LINK_LENGTH = CAR_SPACING - 2 * BOGIE_OFFSET
const DISTANCE_TOLERANCE = 1e-7

/** Layout coordinates: x/y are the table plane, z is height. */
export interface PoseVector { x: number; y: number; z: number }

export interface CarPose {
  /** Midpoint of the bogie chord, rather than a point on the curved rail. */
  center: TrackPoint
  frontBogie: TrackPoint
  rearBogie: TrackPoint
  direction: PoseVector
  pitch: number
  frontOffset: number
  rearOffset: number
  /** Shell centreline ends at rail level; use these to place end details. */
  frontEnd: PoseVector
  rearEnd: PoseVector
  /** Bogie-mounted coupling pivots, including their height above the rail. */
  frontCoupling: PoseVector
  rearCoupling: PoseVector
}

export interface CouplingPose {
  frontCarIndex: number
  rearCarIndex: number
  frontPin: PoseVector
  rearPin: PoseVector
  /** Shared head of the two equal-length, swivelling coupling shanks. */
  point: PoseVector
}

export interface ConsistPoses {
  cars: (CarPose | null)[]
  couplings: CouplingPose[]
  /** Last visible body's nominal trailing extent along the route; zero if none fits. */
  rearOffset: number
}

function distance(a: PoseVector, b: PoseVector): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

function translated(origin: PoseVector, direction: PoseVector, along: number): PoseVector {
  return { x: origin.x + direction.x * along, y: origin.y + direction.y * along, z: origin.z + direction.z * along }
}

/**
 * Find the first rail point behind an existing pivot at a fixed chord distance.
 * Bracket locally before solving, so turns never use the far side of a circuit.
 * Bracketing follows the nearest chord solution even through track joins.
 */
function chordBehind(
  sample: (offset: number) => TrackPoint | null,
  originOffset: number,
  origin: TrackPoint,
  span: number,
): { offset: number; point: TrackPoint } | null {
  let lower = originOffset
  let lowerDistance = 0
  let upper = originOffset + span
  let upperPoint: TrackPoint | null = null
  let upperDistance = 0
  for (let attempt = 0; attempt < 8; attempt += 1) {
    upperPoint = sample(upper)
    if (!upperPoint) {
      // A grade may reach the 3D chord before the nominal route offset. Find
      // the real open endpoint before deciding whether this body fits.
      let valid = lower
      let invalid = upper
      for (let iteration = 0; iteration < 32; iteration += 1) {
        const middle = (valid + invalid) / 2
        if (sample(middle)) valid = middle
        else invalid = middle
      }
      upper = valid
      upperPoint = sample(upper)
      if (!upperPoint) return null
      upperDistance = distance(origin, upperPoint)
      if (upperDistance < span - DISTANCE_TOLERANCE) return null
      break
    }
    upperDistance = distance(origin, upperPoint)
    if (upperDistance >= span - DISTANCE_TOLERANCE) break
    lower = upper
    lowerDistance = upperDistance
    upper = originOffset + (upper - originOffset) * 1.25
  }
  if (!upperPoint || upperDistance < span - DISTANCE_TOLERANCE) return null
  if (Math.abs(upperDistance - span) <= DISTANCE_TOLERANCE) return { offset: upper, point: upperPoint }

  // A safeguarded secant converges quickly on straight/curve transitions;
  // bisection keeps a strict local bracket when the interpolant reaches an end.
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const fraction = (span - lowerDistance) / (upperDistance - lowerDistance)
    const offset = lower + (upper - lower) * (fraction > .01 && fraction < .99 ? fraction : .5)
    const point = sample(offset)
    if (!point) return null
    const chord = distance(origin, point)
    if (Math.abs(chord - span) <= DISTANCE_TOLERANCE) return { offset, point }
    if (chord < span) {
      lower = offset
      lowerDistance = chord
    } else {
      upper = offset
      upperDistance = chord
      upperPoint = point
    }
  }
  return { offset: upper, point: upperPoint }
}

/**
 * Rigid bodies supported by two rail-bound bogies and connected by fixed links.
 * Route offsets grow through curves while the actual bodies/shanks stay fixed
 * length. Reversing changes travel direction, never the original cab reference.
 */
export function solveConsistPoses(
  tracks: Track[],
  position: TrainPosition,
  cabForward: boolean,
  carCount: number,
  trainType: TrainType = 'e235',
): ConsistPoses {
  return withTrackGraph(tracks, () => solveConsistPosesOnGraph(tracks, position, cabForward, carCount, trainType))
}

function solveConsistPosesOnGraph(
  tracks: Track[], position: TrainPosition, cabForward: boolean, carCount: number, trainType: TrainType,
): ConsistPoses {
  const count = Number.isFinite(carCount) ? Math.max(0, Math.floor(carCount)) : 0
  const cars: (CarPose | null)[] = Array(count).fill(null)
  const couplings: CouplingPose[] = []
  if (!count) return { cars, couplings, rearOffset: 0 }
  const physicalPosition: TrainPosition = {
    ...position,
    direction: cabForward ? position.direction : position.direction === 1 ? -1 : 1,
  }
  const samples = new Map<number, TrackPoint | null>()
  const sample = (offset: number): TrackPoint | null => {
    if (!samples.has(offset)) samples.set(offset, sampleBehind(tracks, physicalPosition, offset))
    return samples.get(offset) ?? null
  }
  const leadingSpec = getTrainCarSpec(trainType, 0, count)
  let frontOffset = leadingSpec.length / 2 - leadingSpec.bogieOffset
  let frontBogie = sample(frontOffset)
  let rearOffset = 0
  for (let index = 0; index < count && frontBogie; index += 1) {
    const spec = getTrainCarSpec(trainType, index, count)
    const rear = chordBehind(sample, frontOffset, frontBogie, 2 * spec.bogieOffset)
    // Never extrapolate a wheel pose past an open end or an inactive turnout.
    if (!rear) break
    const rearBogie = rear.point
    const chord = distance(frontBogie, rearBogie)
    const direction: PoseVector = {
      x: (frontBogie.x - rearBogie.x) / chord,
      y: (frontBogie.y - rearBogie.y) / chord,
      z: (frontBogie.z - rearBogie.z) / chord,
    }
    const horizontal = Math.hypot(direction.x, direction.y)
    const center: TrackPoint = {
      x: (frontBogie.x + rearBogie.x) / 2,
      y: (frontBogie.y + rearBogie.y) / 2,
      z: (frontBogie.z + rearBogie.z) / 2,
      angle: Math.atan2(direction.y, direction.x),
      slope: direction.z / Math.max(horizontal, 1e-9),
    }
    const car: CarPose = {
      center,
      frontBogie,
      rearBogie,
      direction,
      pitch: Math.atan2(direction.z, horizontal),
      frontOffset,
      rearOffset: rear.offset,
      frontEnd: translated(center, direction, spec.length / 2),
      rearEnd: translated(center, direction, -spec.length / 2),
      // A bogie-mounted pivot can articulate vertically relative to the shell
      // on grade transitions. A common rail-height offset keeps both fixed
      // shanks connected without pitching or stretching them independently.
      frontCoupling: { x: frontBogie.x, y: frontBogie.y, z: frontBogie.z + COUPLING_HEIGHT },
      rearCoupling: { x: rearBogie.x, y: rearBogie.y, z: rearBogie.z + COUPLING_HEIGHT },
    }
    cars[index] = car
    rearOffset = rear.offset + spec.length / 2 - spec.bogieOffset
    const preceding = cars[index - 1]
    if (preceding) {
      const frontPin = preceding.rearCoupling
      const rearPin = car.frontCoupling
      couplings.push({
        frontCarIndex: index - 1,
        rearCarIndex: index,
        frontPin,
        rearPin,
        point: { x: (frontPin.x + rearPin.x) / 2, y: (frontPin.y + rearPin.y) / 2, z: (frontPin.z + rearPin.z) / 2 },
      })
    }
    if (index + 1 === count) break
    const next = chordBehind(sample, rear.offset, rearBogie, getCouplingLinkLength(trainType, index, count))
    if (!next) break
    frontOffset = next.offset
    frontBogie = next.point
  }
  return { cars, couplings, rearOffset }
}
