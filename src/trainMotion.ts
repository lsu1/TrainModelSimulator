import { advanceTrain, sampleBehind } from './track'
import type { Track, TrainAdvance, TrainPosition } from './track'
import { BOGIE_OFFSET, solveConsistPoses } from './consistPose'
import { CAR_LENGTH } from './trainModel'

/** Movement keeps the original cab reference so reversing does not move the cars. */
export function advanceConsist(
  tracks: Track[],
  position: TrainPosition,
  distance: number,
  cabForward: boolean,
  carCount: number,
): TrainAdvance {
  const proposed = advanceTrain(tracks, position, distance)
  if (cabForward || distance <= 0 || !Number.isFinite(distance)) return proposed
  const physicalPosition = (reference: TrainPosition): TrainPosition => ({
    ...reference,
    direction: reference.direction === 1 ? -1 : 1,
  })
  const initial = solveConsistPoses(tracks, position, false, carCount)
  const visibleCount = initial.cars.filter(Boolean).length
  if (!visibleCount) return proposed
  // A partially placed last body may already overhang an unfinished railway.
  // Keep its complete bogies visible and stop the rear bogie at that endpoint.
  const includeOverhang = sampleBehind(tracks, physicalPosition(position), initial.rearOffset) !== null
  const formationFits = (reference: TrainPosition): boolean => {
    const poses = solveConsistPoses(tracks, reference, false, carCount)
    if (poses.cars.filter(Boolean).length < visibleCount) return false
    const last = poses.cars[visibleCount - 1]
    if (!last) return false
    // Recompute the tail offset: rigid-car chord spans grow and shrink as each
    // bogie passes a straight/curve transition.
    // An accepted small endpoint overlap can make another rear car fit while
    // reversing. Preserve the existing cars' boundary without blocking that
    // newly complete car from appearing.
    const offset = last.rearOffset + (includeOverhang ? CAR_LENGTH / 2 - BOGIE_OFFSET : 0)
    return sampleBehind(tracks, physicalPosition(reference), offset) !== null
  }
  if (formationFits(proposed.position)) return proposed

  // Stop the visible rear at the open rail end, rather than hiding the formation
  // while the original cab continues toward that same end.
  let validDistance = 0
  let invalidDistance = distance
  for (let iteration = 0; iteration < 48; iteration += 1) {
    const middle = (validDistance + invalidDistance) / 2
    const candidate = advanceTrain(tracks, position, middle)
    if (formationFits(candidate.position)) validDistance = middle
    else invalidDistance = middle
  }
  return { ...advanceTrain(tracks, position, validDistance), stopped: true }
}

/** Track pieces under the formation, including its original cab and both ends. */
export function occupiedTrackIds(
  tracks: Track[],
  position: TrainPosition,
  cabForward: boolean,
  carCount: number,
): Set<string> {
  const occupied = new Set<string>()
  if (!tracks.some(track => track.id === position.trackId)) return occupied
  occupied.add(position.trackId)
  const physicalDirection = cabForward ? position.direction : position.direction === 1 ? -1 : 1
  let trace: TrainPosition = { ...position, direction: physicalDirection === 1 ? -1 : 1 }
  let remaining = solveConsistPoses(tracks, position, cabForward, carCount).rearOffset
  // The shortest supported catalog piece is 29 mm, so a 20 mm step cannot
  // cross a whole piece without recording it. Stop where the real rail stops.
  while (remaining > 0) {
    const step = Math.min(20, remaining)
    const result = advanceTrain(tracks, trace, step)
    occupied.add(result.position.trackId)
    trace = result.position
    if (result.stopped) break
    remaining -= step
  }
  return occupied
}
