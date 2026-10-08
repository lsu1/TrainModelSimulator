import type { TrainRuntime, TrainSnapshot } from './fleet'
import { KATO_CATALOG } from './catalog'
import { advanceConsist, occupiedTrackIds } from './trainMotion'
import { advanceTrain, closedRouteLength, withTrackGraph } from './track'
import type { Track, TrainPosition } from './track'
import { clampTrainSpeed, getTrainSpec } from './trains'
import { bodyOccupiedTurnoutIds, safetyBoundsIntersect, sweptTrainFootprintsConflict, trainFootprint, trainFootprintsConflict, trainFootprintOverlapsItself } from './trainSafety'
import type { TrainFootprint } from './trainSafety'

export const TRAIN_ACCELERATION_KMH_PER_SECOND = 180
export const TRAIN_BRAKING_KMH_PER_SECOND = 240
/** Like the original clock, background-tab time is discarded, not teleported. */
export const MAX_FLEET_FRAME_SECONDS = .1
const MAX_RAIL_ADVANCE = 2
const CIRCUITS = new WeakMap<Track[], Map<string, number | null>>()
const FRAME_FOOTPRINTS = new WeakMap<Track[], { graph: string; trains: Map<string, { key: string; footprint: TrainFootprint }> }>()
const END_REASON = 'End of the line! Check the connectors or reverse.'
const TRACK_SHAPES = new Map(KATO_CATALOG.map(item => [item.kind, item.shape]))

type JunctionOccupancy = Map<string, Set<number>>
function junctionOccupancy(tracks: Track[], train: TrainRuntime, footprint: TrainFootprint): JunctionOccupancy {
  const result: JunctionOccupancy = new Map()
  if (!train.position) return result
  const physicalDirection = train.cabForward ? train.position.direction : -train.position.direction
  let position: TrainPosition = { ...train.position, direction: physicalDirection === 1 ? -1 : 1 }
  let remaining = footprint.rearOffset
  const record = () => {
    const track = tracks.find(piece => piece.id === position.trackId)
    const shape = track && TRACK_SHAPES.get(track.kind)
    if (shape !== 'crossing' && shape !== 'scissors' && shape !== 'turnout') return
    const routes = result.get(position.trackId) ?? new Set<number>()
    routes.add(position.route ?? 0); result.set(position.trackId, routes)
  }
  record()
  while (remaining > 0) {
    const step = Math.min(20, remaining), next = advanceTrain(tracks, position, step)
    position = next.position; record()
    if (next.stopped) break
    remaining -= step
  }
  return result
}
function conflictingJunctions(tracks: Track[], a: JunctionOccupancy, b: JunctionOccupancy): string[] {
  const result: string[] = []
  for (const [id, routesA] of a) {
    const routesB = b.get(id)
    if (!routesB) continue
    const track = tracks.find(piece => piece.id === id)
    const shape = track && TRACK_SHAPES.get(track.kind)
    if ([...routesA].some(first => [...routesB].some(second => first !== second && (shape !== 'scissors' || first >= 2 || second >= 2)))) result.push(id)
  }
  return result
}

const millimetersPerSecond = (train: TrainSnapshot, speed: number) => speed / 3.6 * 1000 / getTrainSpec(train.type).scale
const travelDistance = (train: TrainRuntime, seconds: number) => millimetersPerSecond(train, train.actualSpeed) * seconds
const footprintKey = (train: TrainSnapshot) => `${train.type}:${train.carCount}:${train.position?.trackId}:${train.position?.route ?? 0}:${train.position?.distance}:${train.position ? (train.cabForward ? train.position.direction : -train.position.direction) : 0}`
function frameCache(tracks: Track[]) {
  // React replaces edited track arrays. The fingerprint also protects callers
  // that mutate a track in place, as supported by the existing geometry tests.
  const graph = tracks.map(track => `${track.id}:${track.kind}:${track.x}:${track.y}:${track.angle}:${track.bend}:${track.elevation ?? 0}:${track.endElevation ?? track.elevation ?? 0}:${track.switchState ?? 'straight'}`).join('|')
  let cached = FRAME_FOOTPRINTS.get(tracks)
  if (!cached || cached.graph !== graph) {
    cached = { graph, trains: new Map() }; FRAME_FOOTPRINTS.set(tracks, cached)
    CIRCUITS.delete(tracks)
  }
  return cached
}
function couldMeet(a: TrainFootprint, b: TrainFootprint, distance: number): boolean {
  // Rail displacement plus the rotation of a long body/nose. This only removes
  // distant pairs; close pairs still use the actual swept 3D volumes below.
  const allowance = distance * 4 + 2
  return safetyBoundsIntersect(a.bounds, b.bounds, allowance)
    && a.volumes.some(first => b.volumes.some(second => safetyBoundsIntersect(first.bounds, second.bounds, allowance)))
}
function circuitLength(tracks: Track[], position: TrainPosition): number | null {
  let cached = CIRCUITS.get(tracks)
  if (!cached) { cached = new Map(); CIRCUITS.set(tracks, cached) }
  const key = `${position.trackId}:${position.route ?? 0}:${position.direction}`
  if (!cached.has(key)) cached.set(key, closedRouteLength(tracks, position))
  return cached.get(key) ?? null
}
function moved(tracks: Track[], train: TrainRuntime, distance: number): TrainRuntime {
  if (!train.position || distance <= 0) return train
  const result = advanceConsist(tracks, train.position, distance, train.cabForward, train.carCount, train.type)
  const circumference = circuitLength(tracks, train.position)
  const progress = train.lapProgress + distance
  const laps = circumference ? Math.floor(progress / circumference) : 0
  return {
    ...train, position: { ...result.position, laps: train.position.laps + laps },
    lapProgress: circumference ? progress % circumference : progress,
    ...(result.stopped ? { running: false, actualSpeed: 0, status: 'blocked' as const, stopReason: END_REASON } : {}),
  }
}
function travelVector(footprint: TrainFootprint, train: TrainSnapshot) {
  const axis = footprint.volumes[0]?.axes[0] ?? { x: 1, y: 0, z: 0 }
  const sign = train.cabForward ? 1 : -1
  return { x: axis.x * sign, y: axis.y * sign, z: axis.z * sign }
}
function brakingParticipants(first: TrainRuntime, second: TrainRuntime, a: TrainFootprint, b: TrainFootprint): string[] {
  if (!first.running || first.actualSpeed === 0) return [second.id]
  if (!second.running || second.actualSpeed === 0) return [first.id]
  const directionA = travelVector(a, first), directionB = travelVector(b, second)
  const dot = directionA.x * directionB.x + directionA.y * directionB.y + directionA.z * directionB.z
  if (dot < -.7) return [first.id, second.id]
  if (dot > .7 && a.volumes[0] && b.volumes[0]) {
    const delta = { x: b.volumes[0].center.x - a.volumes[0].center.x, y: b.volumes[0].center.y - a.volumes[0].center.y, z: b.volumes[0].center.z - a.volumes[0].center.z }
    return [delta.x * directionA.x + delta.y * directionA.y + delta.z * directionA.z > 0 ? first.id : second.id]
  }
  // Stable priority at junctions; the waiting set must be restarted explicitly.
  return [first.id.localeCompare(second.id) < 0 ? second.id : first.id]
}

function brakingLookahead(tracks: Track[], fleet: TrainRuntime[], footprints: TrainFootprint[]): Map<string, string> {
  const reasons = new Map<string, string>()
  if (fleet.length < 2 || !fleet.some(train => train.running && train.actualSpeed > 0)) return reasons
  const hasJunctions = tracks.some(track => ['crossing', 'scissors', 'turnout'].includes(TRACK_SHAPES.get(track.kind) ?? ''))
  const existingOccupancy = new Map<string, JunctionOccupancy>()
  const occupancy = (train: TrainRuntime, footprint: TrainFootprint) => {
    let existing = existingOccupancy.get(train.id)
    if (!existing) { existing = junctionOccupancy(tracks, train, footprint); existingOccupancy.set(train.id, existing) }
    return existing
  }
  const previews = new Map<string, { footprint: TrainFootprint; occupancy: JunctionOccupancy }[]>()
  for (let first = 0; first < fleet.length; first++) for (let second = first + 1; second < fleet.length; second++) {
    const a = fleet[first], b = fleet[second]
    if (!a.position || !b.position || !(a.running && a.actualSpeed > 0 || b.running && b.actualSpeed > 0)) continue
    const horizon = Math.max(a.actualSpeed, b.actualSpeed) / TRAIN_BRAKING_KMH_PER_SECOND / 2 + .1
    if (!couldMeet(footprints[first], footprints[second], (a.running ? travelDistance(a, horizon) : 0) + (b.running ? travelDistance(b, horizon) : 0))) continue
    const projected = (train: TrainRuntime): { footprint: TrainFootprint; occupancy: JunctionOccupancy }[] => {
      const key = `${train.id}:${horizon}`
      const cached = previews.get(key)
      if (cached) return cached
      const result = [.33, .67, 1].map(fraction => {
        const future = moved(tracks, train, train.running ? travelDistance(train, horizon * fraction) : 0)
        const footprint = trainFootprint(tracks, future)
        return { footprint, occupancy: hasJunctions ? junctionOccupancy(tracks, future, footprint) : new Map() }
      })
      previews.set(key, result); return result
    }
    const aFuture = projected(a), bFuture = projected(b)
    if (hasJunctions) {
      // Reserve conflicting manufactured routes before entry. In particular,
      // the noses of two scissors approaches must wait outside its converging
      // point-blade region; stopping only at the central frog blocks both trains.
      const conflicts = aFuture.flatMap((preview, index) => conflictingJunctions(tracks, preview.occupancy, bFuture[index].occupancy))
      if (conflicts.length) {
        const actualA = occupancy(a, footprints[first]), actualB = occupancy(b, footprints[second])
        const aInside = conflicts.some(id => actualA.has(id)), bInside = conflicts.some(id => actualB.has(id))
        const loser = aInside && !bInside ? b : bInside && !aInside ? a : a.id.localeCompare(b.id) < 0 ? b : a
        const winner = loser.id === a.id ? b : a
        if (loser.running) reasons.set(loser.id, `Waiting for ${winner.name} to clear the junction.`)
      }
    }
    if (aFuture.some((preview, index) => trainFootprintsConflict(preview.footprint, bFuture[index].footprint))) {
      for (const id of brakingParticipants(a, b, footprints[first], footprints[second])) {
        const partner = id === a.id ? b : a
        reasons.set(id, `Waiting for ${partner.name}. There is another train ahead.`)
      }
    }
  }
  return reasons
}

function speedState(train: TrainRuntime, seconds: number, reason?: string): TrainRuntime {
  if (!train.position) return { ...train, actualSpeed: 0, running: false, status: 'unplaced', reverseRequested: false }
  if (!train.running && !train.reverseRequested) return { ...train, actualSpeed: 0, status: train.status === 'blocked' ? 'blocked' : 'stopped' }
  const brakingReason = reason ?? (train.status === 'braking' && train.stopReason ? train.stopReason : undefined)
  const braking = !!train.reverseRequested || !!brakingReason
  const target = braking ? 0 : clampTrainSpeed(train.type, train.requestedSpeed)
  const difference = target - train.actualSpeed
  const rate = difference >= 0 ? TRAIN_ACCELERATION_KMH_PER_SECOND : TRAIN_BRAKING_KMH_PER_SECOND
  const actualSpeed = Math.max(0, train.actualSpeed + Math.sign(difference) * Math.min(Math.abs(difference), rate * seconds))
  if (actualSpeed < 1e-8 && train.reverseRequested) {
    return {
      ...train, actualSpeed: 0, running: false, status: 'stopped', reverseRequested: false, stopReason: undefined,
      cabForward: !train.cabForward,
      position: { ...train.position, direction: train.position.direction === 1 ? -1 : 1 },
      lapProgress: 0,
    }
  }
  if (actualSpeed < 1e-8 && brakingReason)
    return { ...train, actualSpeed: 0, running: false, status: 'blocked', stopReason: brakingReason }
  return {
    ...train, actualSpeed, running: target > 0 || actualSpeed > 0,
    status: difference < 0 ? 'braking' : difference > 0 ? 'accelerating' : actualSpeed > 0 ? 'moving' : 'stopped',
    stopReason: brakingReason,
  }
}

/** All intentions come from one snapshot. Bounded, swept steps cap motion before
 * contact and commit the fleet together; there is no active-train update order.
 */
function stepFleetPrepared(tracks: Track[], fleet: readonly TrainRuntime[], dtSeconds: number): TrainRuntime[] {
  const seconds = Math.min(MAX_FLEET_FRAME_SECONDS, Math.max(0, Number.isFinite(dtSeconds) ? dtSeconds : 0))
  // The public solver also accepts injected runtimes. Normalize before the
  // lookahead/substep calculation so malformed or superseded profiles cannot
  // overrun their own service limit or create unbounded work.
  let current = fleet.map(train => ({
    ...train,
    requestedSpeed: clampTrainSpeed(train.type, train.requestedSpeed),
    actualSpeed: clampTrainSpeed(train.type, train.actualSpeed),
    position: train.position ? { ...train.position } : null,
  }))
  if (!seconds) return current.map(train => speedState(train, 0))
  const cached = frameCache(tracks)
  let footprints = current.map(train => {
    const previous = cached.trains.get(train.id)
    return previous?.key === footprintKey(train) ? previous.footprint : trainFootprint(tracks, train)
  })
  const reasons = brakingLookahead(tracks, current, footprints)
  const maxVelocity = Math.max(0, ...current.map(train => millimetersPerSecond(train, Math.max(train.actualSpeed, train.running ? train.requestedSpeed : 0))))
  const hasNearbyTrains = current.some((a, first) => current.slice(first + 1).some((b, offset) =>
    couldMeet(footprints[first], footprints[first + 1 + offset], millimetersPerSecond(a, Math.max(a.actualSpeed, a.running ? a.requestedSpeed : 0)) * seconds + millimetersPerSecond(b, Math.max(b.actualSpeed, b.running ? b.requestedSpeed : 0)) * seconds)))
  const steps = hasNearbyTrains ? Math.max(1, Math.ceil(maxVelocity * seconds / MAX_RAIL_ADVANCE)) : 1
  const dt = seconds / steps
  for (let step = 0; step < steps; step++) {
    const ready = current.map(train => speedState(train, dt, reasons.get(train.id)))
    const distances = ready.map(train => train.running ? travelDistance(train, dt) : 0)
    let proposals = ready.map((train, index) => moved(tracks, train, distances[index]))
    let proposedFootprints = proposals.map((train, index) => distances[index] > 0 ? trainFootprint(tracks, train) : footprints[index])
    for (let index = 0; index < proposals.length; index++) {
      if (!distances[index] || !trainFootprintOverlapsItself(proposedFootprints[index])) continue
      let lower = 0, upper = 1
      for (let iteration = 0; iteration < 14; iteration++) {
        const fraction = (lower + upper) / 2
        if (trainFootprintOverlapsItself(trainFootprint(tracks, moved(tracks, ready[index], distances[index] * fraction)))) upper = fraction
        else lower = fraction
      }
      distances[index] *= lower
      proposals[index] = { ...moved(tracks, ready[index], distances[index]), actualSpeed: 0, running: false, status: 'blocked', stopReason: 'The cars would touch here. Check the curve, slope, or loop size.' }
      proposedFootprints[index] = trainFootprint(tracks, proposals[index])
    }
    // Resolve all potentially conflicting pairs. Changed proposals are checked
    // again against earlier pairs, so a three-train chain cannot invalidate a
    // previous safety decision when a middle train is stopped.
    for (let pass = 0; pass < ready.length; pass++) {
      let changed = false
      for (let first = 0; first < ready.length; first++) for (let second = first + 1; second < ready.length; second++) {
        if (!(distances[first] > 0 || distances[second] > 0)) continue
        if (!couldMeet(footprints[first], footprints[second], distances[first] + distances[second])) continue
        if (!sweptTrainFootprintsConflict(footprints[first], proposedFootprints[first], footprints[second], proposedFootprints[second])) continue
        let lower = 0, upper = 1
        for (let iteration = 0; iteration < 14; iteration++) {
          const fraction = (lower + upper) / 2
          const a = trainFootprint(tracks, moved(tracks, ready[first], distances[first] * fraction))
          const b = trainFootprint(tracks, moved(tracks, ready[second], distances[second] * fraction))
          if (sweptTrainFootprintsConflict(footprints[first], a, footprints[second], b)) upper = fraction
          else lower = fraction
        }
        for (const index of [first, second]) {
          if (!distances[index]) continue
          const partner = ready[index === first ? second : first]
          distances[index] *= lower
          proposals[index] = { ...moved(tracks, ready[index], distances[index]), running: false, actualSpeed: 0, status: 'blocked', reverseRequested: false, stopReason: `Stopped safely for ${partner.name}. Choose another route or reverse.` }
          proposedFootprints[index] = trainFootprint(tracks, proposals[index])
          changed = true
        }
      }
      if (!changed) break
    }
    current = proposals
    footprints = proposedFootprints
  }
  cached.trains.clear()
  current.forEach((train, index) => cached.trains.set(train.id, { key: footprintKey(train), footprint: footprints[index] }))
  return current
}

export function stepFleet(tracks: Track[], fleet: readonly TrainRuntime[], dtSeconds: number): TrainRuntime[] {
  return withTrackGraph(tracks, () => stepFleetPrepared(tracks, fleet, dtSeconds))
}

/** All parked and moving bodies lock their turnouts, including nose/tail overhang. */
export function occupiedFleetTrackIds(tracks: Track[], fleet: readonly TrainSnapshot[]): Set<string> {
  return withTrackGraph(tracks, () => {
    const result = new Set<string>()
    for (const train of fleet) if (train.position)
      occupiedTrackIds(tracks, train.position, train.cabForward, train.carCount, train.type).forEach(id => result.add(id))
    bodyOccupiedTurnoutIds(tracks, fleet.filter(train => train.position).map(train => trainFootprint(tracks, train))).forEach(id => result.add(id))
    return result
  })
}
