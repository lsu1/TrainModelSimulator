import { solveConsistPoses } from './consistPose'
import type { CarPose, ConsistPoses, PoseVector } from './consistPose'
import { noseCouplerProfile } from './couplingTypes'
import type { TrainSnapshot } from './fleet'
import { samplePositionBehind, withTrackGraph } from './track'
import type { Track, TrainPosition } from './track'
import type { TrainType } from './trains'

export type FormationNoseEnd = 'front' | 'rear'
export interface FormationNoseEnds {
  e6End?: FormationNoseEnd
  e5End?: FormationNoseEnd
}

export interface NoseJointPose {
  e6Mount: PoseVector
  e5Mount: PoseVector
  /** Common mechanical mating face, not the original streamlined tips. */
  head: PoseVector
  /** Unit vector from the leader mount towards the follower mount. */
  direction: PoseVector
}

export interface CoupledFormationPoses {
  /** Original model indices, even when its rear cab joins another train. */
  e6: ConsistPoses
  e5: ConsistPoses
  e5Position: TrainPosition | null
  /** The follower's physical orientation relative to the shared travel direction. */
  e5CabForward: boolean
  joint: NoseJointPose | null
  complete: boolean
  /** Extent ahead of the leader's original front reference, in route millimetres. */
  frontOffset: number
  /** Extent behind the leader's original front reference, in route millimetres. */
  rearOffset: number
  /** Signed follower original-front reference offset behind the leader reference. */
  e5Offset: number
}

const JOINT_TOLERANCE = 1e-7

function distance(a: PoseVector, b: PoseVector): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

function flip(direction: TrainPosition['direction']): TrainPosition['direction'] {
  return direction === 1 ? -1 : 1
}

/** Body-mounted fittings follow the shell pitch, including the height offset.
 * The omitted end preserves the original E6-rear/E5-front save convention.
 */
export function noseMount(car: CarPose, type: TrainType, end: FormationNoseEnd = type === 'e6' ? 'rear' : 'front'): PoseVector {
  const profile = noseCouplerProfile(type)
  if (!profile) throw new Error('This train has no nose coupler')
  const tip = end === 'rear' ? car.rearEnd : car.frontEnd
  const along = end === 'rear' ? profile.mountInset : -profile.mountInset
  const horizontal = Math.hypot(car.direction.x, car.direction.y)
  const cosine = Math.cos(car.center.angle)
  const sine = Math.sin(car.center.angle)
  return {
    x: tip.x + car.direction.x * along - car.direction.z * cosine * profile.height,
    y: tip.y + car.direction.y * along - car.direction.z * sine * profile.height,
    z: tip.z + car.direction.z * along + horizontal * profile.height,
  }
}

function emptyPoses(count: number): ConsistPoses {
  return { cars: Array(Math.max(0, Math.floor(count))).fill(null), couplings: [], rearOffset: 0 }
}

/** Signed sampling retains the exact lane/route and physical forward direction.
 * Sampling ahead never manufactures a cursor beyond an open rail endpoint.
 */
function signedCursor(tracks: Track[], reference: TrainPosition, offset: number): TrainPosition | null {
  if (offset >= 0) return samplePositionBehind(tracks, reference, offset)
  const sampled = samplePositionBehind(tracks, { ...reference, direction: flip(reference.direction) }, -offset)
  return sampled ? { ...sampled, direction: flip(sampled.direction) } : null
}

/** A single rail-constrained formation with either outside cab of either set
 * joined. The leader retains its independent poses; the follower retains its
 * original car indices, dimensions, roof roles and fixed internal links.
 * Legacy e6/e5 field names identify leader/follower roles, not train models.
 */
export function solveCoupledFormation(
  tracks: Track[], leader: TrainSnapshot, follower: TrainSnapshot, ends: FormationNoseEnds = {},
): CoupledFormationPoses {
  return withTrackGraph(tracks, () => solveOnGraph(tracks, leader, follower, ends))
}

function solveOnGraph(
  tracks: Track[], leader: TrainSnapshot, follower: TrainSnapshot, ends: FormationNoseEnds,
): CoupledFormationPoses {
  const leaderEnd = ends.e6End ?? 'rear'
  const followerEnd = ends.e5End ?? 'front'
  const leaderProfile = noseCouplerProfile(leader.type)
  const followerProfile = noseCouplerProfile(follower.type)
  const first = leader.position && leaderProfile
    ? solveConsistPoses(tracks, leader.position, leader.cabForward, leader.carCount, leader.type) : emptyPoses(leader.carCount)
  const followerCabForward = leaderEnd !== followerEnd ? leader.cabForward : !leader.cabForward
  const unavailable: CoupledFormationPoses = {
    e6: first, e5: emptyPoses(follower.carCount), e5Position: null, e5CabForward: followerCabForward, joint: null,
    complete: false, frontOffset: 0, rearOffset: first.rearOffset, e5Offset: 0,
  }
  const joiningCab = leaderEnd === 'rear' ? first.cars.at(-1) : first.cars[0]
  if (!leader.position || !leaderProfile || !followerProfile || !joiningCab || !first.cars.every(Boolean)) return unavailable
  const physicalReference: TrainPosition = {
    ...leader.position,
    direction: leader.cabForward ? leader.position.direction : flip(leader.position.direction),
  }
  const leaderMount = noseMount(joiningCab, leader.type, leaderEnd)
  const side = leaderEnd === 'rear' ? 1 : -1
  const leaderOutward = {
    x: -side * joiningCab.direction.x, y: -side * joiningCab.direction.y, z: -side * joiningCab.direction.z,
  }
  const jointLength = leaderProfile.extensionLength + followerProfile.extensionLength
  interface Candidate { offset: number; position: TrainPosition; car: CarPose; mount: PoseVector; error: number; outside: boolean }
  const candidates = new Map<number, Candidate | null>()
  const evaluate = (offset: number): Candidate | null => {
    if (candidates.has(offset)) return candidates.get(offset) ?? null
    const cursor = signedCursor(tracks, physicalReference, offset)
    if (!cursor) { candidates.set(offset, null); return null }
    // This virtual first cab always points into the joint. When joining at the
    // original rear, its fully solved reference is converted back below; the
    // original model/roof indices are never reversed for rendering.
    const position: TrainPosition = { ...cursor, direction: side === 1 ? cursor.direction : flip(cursor.direction) }
    const car = solveConsistPoses(tracks, position, true, 1, follower.type).cars[0]
    if (!car) { candidates.set(offset, null); return null }
    const mount = noseMount(car, follower.type, 'front')
    const separation = { x: mount.x - leaderMount.x, y: mount.y - leaderMount.y, z: mount.z - leaderMount.z }
    const outside = separation.x * (leaderOutward.x - car.direction.x)
      + separation.y * (leaderOutward.y - car.direction.y)
      + separation.z * (leaderOutward.z - car.direction.z) > 0
    const candidate = { offset, position, car, mount, error: distance(leaderMount, mount) - jointLength, outside }
    candidates.set(offset, candidate)
    return candidate
  }

  // Removed caps can overlap their original streamlined tips. Search only the
  // nearby root, keeping the selected rails instead of jumping across a loop.
  const nominal = (leaderEnd === 'rear' ? first.rearOffset : 0)
    + side * (jointLength - leaderProfile.mountInset - followerProfile.mountInset)
  const middle = evaluate(nominal)
  let lower: Candidate | null = null
  let upper: Candidate | null = null
  let solution = middle?.outside && Math.abs(middle.error) <= JOINT_TOLERANCE ? middle : null
  if (!solution && middle?.outside) {
    if (middle.error > 0) {
      upper = middle
      for (const step of [2, 4, 8, 16, 24, 32, 48]) {
        const candidate = evaluate(nominal - side * step)
        if (candidate?.outside && candidate.error <= 0) { lower = candidate; break }
      }
    } else {
      lower = middle
      for (const step of [2, 4, 8, 16, 24, 32, 48, 64]) {
        const candidate = evaluate(nominal + side * step)
        if (candidate?.outside && candidate.error >= 0) { upper = candidate; break }
      }
    }
  }
  if (!solution && (!lower || !upper)) {
    lower = null; upper = null
    for (let shift = -48; shift <= 64; shift += 2) {
      const candidate = evaluate(nominal + side * shift)
      if (!candidate?.outside) continue
      if (candidate.error <= 0) lower = candidate
      else if (lower) { upper = candidate; break }
    }
  }
  if (!solution && lower && upper) {
    for (let iteration = 0; iteration < 48; iteration += 1) {
      const fraction = -lower.error / (upper.error - lower.error)
      const offset = lower.offset + (upper.offset - lower.offset) * (fraction > .01 && fraction < .99 ? fraction : .5)
      const candidate = evaluate(offset)
      if (!candidate?.outside) break
      if (Math.abs(candidate.error) <= JOINT_TOLERANCE) { solution = candidate; break }
      if (candidate.error < 0) lower = candidate
      else upper = candidate
    }
  }
  if (!solution) return unavailable
  const virtual = followerEnd === 'rear'
    ? solveConsistPoses(tracks, solution.position, true, follower.carCount, follower.type) : null
  const virtualRearCursor = virtual?.cars.every(Boolean)
    ? samplePositionBehind(tracks, solution.position, virtual.rearOffset) : null
  const originalPhysical = followerEnd === 'front' ? solution.position
    : virtualRearCursor ? { ...virtualRearCursor, direction: flip(virtualRearCursor.direction) } : null
  if (!originalPhysical) return unavailable
  const position: TrainPosition = {
    ...originalPhysical,
    direction: followerCabForward ? originalPhysical.direction : flip(originalPhysical.direction),
  }
  const second = solveConsistPoses(tracks, position, followerCabForward, follower.carCount, follower.type)
  const followerCab = followerEnd === 'rear' ? second.cars.at(-1) : second.cars[0]
  if (!followerCab) return { ...unavailable, e5: second, e5Position: position }
  const followerMount = noseMount(followerCab, follower.type, followerEnd)
  const span = distance(leaderMount, followerMount)
  const direction = {
    x: (followerMount.x - leaderMount.x) / span,
    y: (followerMount.y - leaderMount.y) / span,
    z: (followerMount.z - leaderMount.z) / span,
  }
  const originalOffset = solution.offset + (followerEnd === 'rear' ? side * virtual!.rearOffset : 0)
  const followerTailOffset = originalOffset + (leaderEnd !== followerEnd ? second.rearOffset : -second.rearOffset)
  return {
    e6: first, e5: second, e5Position: position, e5CabForward: followerCabForward,
    joint: {
      e6Mount: leaderMount, e5Mount: followerMount, direction,
      head: {
        x: leaderMount.x + direction.x * leaderProfile.extensionLength,
        y: leaderMount.y + direction.y * leaderProfile.extensionLength,
        z: leaderMount.z + direction.z * leaderProfile.extensionLength,
      },
    },
    complete: second.cars.length > 0 && second.cars.every(Boolean) && Math.abs(span - jointLength) <= 1e-5,
    frontOffset: Math.max(0, -originalOffset, -followerTailOffset),
    rearOffset: Math.max(first.rearOffset, originalOffset, followerTailOffset), e5Offset: originalOffset,
  }
}
