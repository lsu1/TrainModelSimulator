import { KATO_CATALOG } from './catalog'
import type { TrainSnapshot } from './fleet'
import { closedRouteLength, pathsFor, sampleBehind, withTrackGraph } from './track'
import type { Track, TrackRoute, TrainPosition } from './track'
import { getTrainCarSpec } from './trains'
import { trainFootprint, trainFootprintsConflict, trainFootprintOverlapsItself } from './trainSafety'
import type { TrainFootprint } from './trainSafety'

const ITEMS = new Map(KATO_CATALOG.map(item => [item.kind, item]))
export interface PlacementResult { allowed: boolean; reason?: string }
export interface PlacementOptions { allowPartial?: boolean }

function activeRoutes(track: Track): TrackRoute[] {
  const routes = pathsFor(track), shape = ITEMS.get(track.kind)?.shape
  if (shape === 'turnout') return routes.filter(route => route.route === (track.switchState === 'branch' ? 1 : 0))
  if (shape === 'scissors') return routes.filter(route => track.switchState === 'branch' ? route.route >= 2 : route.route < 2)
  return routes
}

function check(tracks: Track[], candidate: TrainSnapshot, otherFootprints: readonly TrainFootprint[], options: PlacementOptions = {}): PlacementResult {
  if (!candidate.position) return { allowed: false, reason: 'Choose a place on the rails for this train.' }
  const position = candidate.position, track = tracks.find(piece => piece.id === position.trackId)
  if (!track) return { allowed: false, reason: 'Choose an existing track for this train.' }
  const route = activeRoutes(track).find(path => path.route === (position.route ?? 0))
  if (!route) return { allowed: false, reason: 'This switch is set to the other route. Change it before placing the train.' }
  if (!Number.isFinite(position.distance) || position.distance < 0 || position.distance > route.length + 1e-6)
    return { allowed: false, reason: 'Place the train within the track’s connectors.' }
  if (!Number.isInteger(candidate.carCount) || candidate.carCount < 3 || candidate.carCount > 11)
    return { allowed: false, reason: 'Choose between 3 and 11 cars for this train.' }
  // Reject impossible long loops cheaply, before solving repeated wrapped cars.
  const nominalLength = Array.from({ length: candidate.carCount }, (_, index) => getTrainCarSpec(candidate.type, index, candidate.carCount).length).reduce((sum, length) => sum + length, 0)
    + (candidate.carCount - 1) * getTrainCarSpec(candidate.type, 0, candidate.carCount).carGap
  const physical = { ...position, direction: candidate.cabForward ? position.direction : position.direction === 1 ? -1 as const : 1 as const }
  const circumference = closedRouteLength(tracks, physical)
  if (circumference !== null && nominalLength + 2 > circumference)
    return { allowed: false, reason: 'This train is too long for this loop. Choose fewer cars or build a larger loop.' }
  const footprint = trainFootprint(tracks, candidate)
  if (!footprint.visibleCars || (!options.allowPartial && (!footprint.complete || !sampleBehind(tracks, physical, footprint.rearOffset))))
    return { allowed: false, reason: 'The whole train needs connected rails. Move it farther along the track or choose fewer cars.' }
  if ((circumference !== null && footprint.rearOffset + 2 > circumference) || trainFootprintOverlapsItself(footprint))
    return { allowed: false, reason: 'This train would overlap itself. Choose fewer cars or a larger curve or loop.' }
  if (otherFootprints.some(other => trainFootprintsConflict(footprint, other)))
    return { allowed: false, reason: 'Another train is too close here. Choose a clear stretch of track.' }
  return { allowed: true }
}

export function validateTrainPlacement(tracks: Track[], candidate: TrainSnapshot, fleet: readonly TrainSnapshot[], options: PlacementOptions = {}): PlacementResult {
  return withTrackGraph(tracks, () => check(tracks, candidate, fleet.filter(train => train.id !== candidate.id && train.position).map(train => trainFootprint(tracks, train)), options))
}

/** Automatically look on actual connected rails; never move existing trains. */
function findTrainPlacementPrepared(tracks: Track[], candidate: TrainSnapshot, fleet: readonly TrainSnapshot[]): TrainPosition | null {
  const others = fleet.filter(train => train.id !== candidate.id && train.position).map(train => trainFootprint(tracks, train))
  for (const track of tracks) for (const route of activeRoutes(track)) {
    const steps = Math.max(1, Math.ceil(route.length / 24))
    for (let step = steps; step >= 0; step--) {
      for (const direction of [1, -1] as const) {
        const position: TrainPosition = { trackId: track.id, route: route.route, distance: route.length * step / steps, direction, laps: 0 }
        if (check(tracks, { ...candidate, position }, others).allowed) return position
      }
    }
  }
  return null
}

export function findTrainPlacement(tracks: Track[], candidate: TrainSnapshot, fleet: readonly TrainSnapshot[]): TrainPosition | null {
  return withTrackGraph(tracks, () => findTrainPlacementPrepared(tracks, candidate, fleet))
}

/** Nearest active lane at its real height. World ray hits use layout x/y/z. */
export function closestTrainPlacement(tracks: Track[], trackId: string, point: { x: number; y: number; z: number }, direction: 1 | -1): TrainPosition | null {
  const track = tracks.find(piece => piece.id === trackId)
  if (!track || ![point.x, point.y, point.z].every(Number.isFinite)) return null
  let closest: { route: TrackRoute; distance: number; squared: number } | undefined
  for (const route of activeRoutes(track)) {
    const squared = (distance: number) => {
      const at = route.pointAt(distance)
      return (at.x - point.x) ** 2 + (at.y - point.y) ** 2 + (at.z - point.z) ** 2
    }
    const count = Math.max(1, Math.ceil(route.length / 8))
    let best = 0
    for (let step = 0; step <= count; step++) if (squared(route.length * step / count) < squared(best)) best = route.length * step / count
    let lower = Math.max(0, best - 8), upper = Math.min(route.length, best + 8)
    for (let iteration = 0; iteration < 24; iteration++) {
      const first = lower + (upper - lower) / 3, second = upper - (upper - lower) / 3
      if (squared(first) < squared(second)) upper = second
      else lower = first
    }
    const distance = (lower + upper) / 2, value = squared(distance)
    if (!closest || value < closest.squared) closest = { route, distance, squared: value }
  }
  return closest ? { trackId, route: closest.route.route, distance: closest.distance, direction, laps: 0 } : null
}
