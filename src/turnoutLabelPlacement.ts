import { pathsFor } from './track'
import type { Track } from './track'

export const TURNOUT_LABEL_LIFT = 6

/** Keep a label on its own rail. Side offsets can cross adjacent 33 mm lanes. */
export function turnoutLabelPlacement(track: Track, railTop = 7.35) {
  const path = pathsFor(track)[0]
  const point = path.pointAt(Math.min(38, path.length / 4))
  const anchor = { x: point.x, y: point.y, z: point.z + railTop }
  return { anchor, position: { ...anchor, z: anchor.z + TURNOUT_LABEL_LIFT } }
}
