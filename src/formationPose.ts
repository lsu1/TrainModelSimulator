import { solveConsistPoses } from './consistPose'
import type { CarPose, ConsistPoses, PoseVector } from './consistPose'
import { NOSE_COUPLER_PROFILES, NOSE_JOINT_LENGTH } from './couplingTypes'
import type { TrainSnapshot } from './fleet'
import { samplePositionBehind, withTrackGraph } from './track'
import type { Track, TrainPosition } from './track'

export interface NoseJointPose {
  e6Mount: PoseVector
  e5Mount: PoseVector
  /** Common mechanical mating face, not the original streamlined tips. */
  head: PoseVector
  /** Unit vector from the E6 mount towards the E5 mount. */
  direction: PoseVector
}

export interface CoupledFormationPoses {
  e6: ConsistPoses
  e5: ConsistPoses
  e5Position: TrainPosition | null
  joint: NoseJointPose | null
  complete: boolean
  /** Mixed formation's trailing extent, measured behind the E6 reference. */
  rearOffset: number
  /** Exact E5 reference offset behind the E6 reference on the selected rails. */
  e5Offset: number
}

const JOINT_TOLERANCE = 1e-7

function distance(a: PoseVector, b: PoseVector): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

/** Supported physical nose only: E6 last/rear cab and E5 first/front cab.
 * Body-mounted fittings follow the car's pitch, rather than world vertical.
 */
export function noseMount(car: CarPose, type: 'e5' | 'e6'): PoseVector {
  const profile = NOSE_COUPLER_PROFILES[type]
  const end = type === 'e6' ? car.rearEnd : car.frontEnd
  const along = type === 'e6' ? profile.mountInset : -profile.mountInset
  const horizontal = Math.hypot(car.direction.x, car.direction.y)
  const cosine = Math.cos(car.center.angle)
  const sine = Math.sin(car.center.angle)
  return {
    x: end.x + car.direction.x * along - car.direction.z * cosine * profile.height,
    y: end.y + car.direction.y * along - car.direction.z * sine * profile.height,
    z: end.z + car.direction.z * along + horizontal * profile.height,
  }
}

function emptyPoses(count: number): ConsistPoses {
  return { cars: Array(Math.max(0, Math.floor(count))).fill(null), couplings: [], rearOffset: 0 }
}

/** One rail-constrained mixed formation, retaining both sets' original models,
 * indices, roof roles and fixed internal links. E6 is the canonical authority.
 * Its independent poses are untouched; E5's exact reference is solved locally
 * from the fixed body-mounted nose joint and the same connected rail graph.
 */
export function solveCoupledFormation(tracks: Track[], e6: TrainSnapshot, e5: TrainSnapshot): CoupledFormationPoses {
  return withTrackGraph(tracks, () => solveOnGraph(tracks, e6, e5))
}

function solveOnGraph(tracks: Track[], e6: TrainSnapshot, e5: TrainSnapshot): CoupledFormationPoses {
  const first = e6.position && e6.type === 'e6'
    ? solveConsistPoses(tracks, e6.position, e6.cabForward, e6.carCount, 'e6') : emptyPoses(e6.carCount)
  const unavailable: CoupledFormationPoses = {
    e6: first, e5: emptyPoses(e5.carCount), e5Position: null, joint: null,
    complete: false, rearOffset: first.rearOffset, e5Offset: 0,
  }
  const rearCab = first.cars.at(-1)
  if (!e6.position || e5.type !== 'e5' || !rearCab || !first.cars.every(Boolean)) return unavailable
  const physicalReference: TrainPosition = {
    ...e6.position,
    direction: e6.cabForward ? e6.position.direction : e6.position.direction === 1 ? -1 : 1,
  }
  const e6Mount = noseMount(rearCab, 'e6')
  interface Candidate { offset: number; position: TrainPosition; car: CarPose; mount: PoseVector; error: number; behind: boolean }
  const candidates = new Map<number, Candidate | null>()
  const evaluate = (offset: number): Candidate | null => {
    if (candidates.has(offset)) return candidates.get(offset) ?? null
    const cursor = offset >= 0 ? samplePositionBehind(tracks, physicalReference, offset) : null
    if (!cursor) { candidates.set(offset, null); return null }
    const position: TrainPosition = {
      ...cursor,
      direction: e6.cabForward ? cursor.direction : cursor.direction === 1 ? -1 : 1,
    }
    // Only the first E5 cab participates in the root. Its cab spec is identical
    // at every supported set length; solve the other original cars once below.
    const car = solveConsistPoses(tracks, position, e6.cabForward, 1, 'e5').cars[0]
    if (!car) { candidates.set(offset, null); return null }
    const mount = noseMount(car, 'e5')
    const separation = { x: e6Mount.x - mount.x, y: e6Mount.y - mount.y, z: e6Mount.z - mount.z }
    const behind = separation.x * (rearCab.direction.x + car.direction.x)
      + separation.y * (rearCab.direction.y + car.direction.y)
      + separation.z * (rearCab.direction.z + car.direction.z) > 0
    const candidate = { offset, position, car, mount, error: distance(e6Mount, mount) - NOSE_JOINT_LENGTH, behind }
    candidates.set(offset, candidate)
    return candidate
  }

  // On a straight the removed caps permit 17 mm of original-tip overlap.
  // A bounded search around that physical estimate selects the local trailing
  // root. It cannot jump to another lap, nearby lane, or far side of a curve.
  const nominal = first.rearOffset + NOSE_JOINT_LENGTH
    - NOSE_COUPLER_PROFILES.e6.mountInset - NOSE_COUPLER_PROFILES.e5.mountInset
  const middle = evaluate(nominal)
  let lower: Candidate | null = null
  let upper: Candidate | null = null
  let solution = middle?.behind && Math.abs(middle.error) <= JOINT_TOLERANCE ? middle : null
  if (!solution && middle?.behind) {
    if (middle.error > 0) {
      upper = middle
      for (const step of [2, 4, 8, 16, 24, 32, 48]) {
        const candidate = evaluate(nominal - step)
        if (candidate?.behind && candidate.error <= 0) { lower = candidate; break }
      }
    } else {
      lower = middle
      for (const step of [2, 4, 8, 16, 24, 32, 48, 64]) {
        const candidate = evaluate(nominal + step)
        if (candidate?.behind && candidate.error >= 0) { upper = candidate; break }
      }
    }
  }
  if (!solution && (!lower || !upper)) {
    lower = null; upper = null
    for (let offset = Math.max(0, nominal - 48); offset <= nominal + 64; offset += 2) {
      const candidate = evaluate(offset)
      if (!candidate?.behind) continue
      if (candidate.error <= 0) lower = candidate
      else if (lower) { upper = candidate; break }
    }
  }
  if (!solution && lower && upper) {
    for (let iteration = 0; iteration < 48; iteration += 1) {
      const fraction = -lower.error / (upper.error - lower.error)
      const offset = lower.offset + (upper.offset - lower.offset) * (fraction > .01 && fraction < .99 ? fraction : .5)
      const candidate = evaluate(offset)
      if (!candidate?.behind) break
      if (Math.abs(candidate.error) <= JOINT_TOLERANCE) { solution = candidate; break }
      if (candidate.error < 0) lower = candidate
      else upper = candidate
    }
  }
  if (!solution) return unavailable
  const second = solveConsistPoses(tracks, solution.position, e6.cabForward, e5.carCount, 'e5')
  const span = distance(e6Mount, solution.mount)
  const direction = {
    x: (solution.mount.x - e6Mount.x) / span,
    y: (solution.mount.y - e6Mount.y) / span,
    z: (solution.mount.z - e6Mount.z) / span,
  }
  const extension = NOSE_COUPLER_PROFILES.e6.extensionLength
  return {
    e6: first, e5: second, e5Position: solution.position,
    joint: {
      e6Mount, e5Mount: solution.mount, direction,
      head: { x: e6Mount.x + direction.x * extension, y: e6Mount.y + direction.y * extension, z: e6Mount.z + direction.z * extension },
    },
    complete: second.cars.length > 0 && second.cars.every(Boolean),
    rearOffset: solution.offset + second.rearOffset, e5Offset: solution.offset,
  }
}
