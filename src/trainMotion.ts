import { advanceTrain, sampleBehind } from './track'
import type { Track, TrainAdvance, TrainPosition } from './track'
import { CAR_LENGTH, CAR_SPACING } from './trainModel'

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
  let rearOffset: number | null = null
  // Short unfinished railways may show only part of the chosen formation.
  for (let index = 0; index < carCount; index += 1) {
    const centerOffset = CAR_LENGTH / 2 + index * CAR_SPACING
    if (!sampleBehind(tracks, physicalPosition(position), centerOffset)) continue
    const bodyOffset = CAR_LENGTH + index * CAR_SPACING
    rearOffset = sampleBehind(tracks, physicalPosition(position), bodyOffset) ? bodyOffset : centerOffset
  }
  if (rearOffset === null || sampleBehind(tracks, physicalPosition(proposed.position), rearOffset)) return proposed

  // Stop the visible rear at the open rail end, rather than hiding the formation
  // while the original cab continues toward that same end.
  let validDistance = 0
  let invalidDistance = distance
  for (let iteration = 0; iteration < 48; iteration += 1) {
    const middle = (validDistance + invalidDistance) / 2
    const candidate = advanceTrain(tracks, position, middle)
    if (sampleBehind(tracks, physicalPosition(candidate.position), rearOffset)) validDistance = middle
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
  let remaining = CAR_LENGTH + Math.max(0, carCount - 1) * CAR_SPACING
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
