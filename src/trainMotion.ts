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
