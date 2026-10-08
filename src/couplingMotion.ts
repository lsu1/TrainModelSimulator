import { solveConsistPoses } from './consistPose'
import type { PoseVector } from './consistPose'
import { COUPLING_APPROACH_SPEED, COUPLING_MAX_APPROACH_DISTANCE, COUPLING_SEPARATION_DISTANCE } from './couplingTypes'
import type { CouplingGroup, CouplingOperation, NoseCouplingState } from './couplingTypes'
import { trainSnapshot } from './fleet'
import type { TrainRuntime } from './fleet'
import { stepFleet } from './fleetMotion'
import { noseMount, solveCoupledFormation } from './formationPose'
import { advanceConsist } from './trainMotion'
import { advanceTrain, closedRouteLength, pointAt, sampleBehind, withTrackGraph } from './track'
import type { Track, TrainPosition } from './track'
import { combineTrainFootprints, physicalTrainFootprintsConflict, sweptTrainFootprintsConflict, trainFootprint, trainFootprintFromPoses, trainFootprintOverlapsItself, trainFootprintsConflict } from './trainSafety'
import type { TrainFootprint } from './trainSafety'
import { getTrainSpec } from './trains'

export interface CouplingEligibility { allowed: boolean; reason?: string; gap?: number }
export interface CouplingStep { fleet: TrainRuntime[]; groups: CouplingGroup[]; operation: CouplingOperation | null; message?: string }
const CLOSED: NoseCouplingState = { open: 0, extension: 0, locked: false }
const OPEN: NoseCouplingState = { open: 1, extension: 1, locked: false }
const LOCKED: NoseCouplingState = { ...OPEN, locked: true }
const OPEN_TIME = 1.2
const LOCK_TIME = .5
const CLOSE_TIME = 1.2
const flip = (value: 1 | -1): 1 | -1 => value === 1 ? -1 : 1
const stopped = (train: TrainRuntime): boolean => !train.running && train.actualSpeed < 1e-7 && !train.reverseRequested
const physicalCursor = (train: TrainRuntime): TrainPosition | null => train.position ? { ...train.position, direction: train.cabForward ? train.position.direction : flip(train.position.direction) } : null
const dot = (a: PoseVector, b: PoseVector) => a.x * b.x + a.y * b.y + a.z * b.z
const no = (reason: string): CouplingEligibility => ({ allowed: false, reason })
const paused = (train: TrainRuntime): TrainRuntime => ({ ...train, actualSpeed: 0, running: false, status: train.position ? 'stopped' : 'unplaced', reverseRequested: false, stopReason: undefined })

/** Exact route distance to a local cursor. Nearby parallel/elevated tracks never
 * count as the same rails. Direction is the physical cab orientation. */
function routeDistance(tracks: Track[], from: TrainPosition, to: TrainPosition, maximum: number): number | null {
  let cursor = { ...from }, traveled = 0
  while (traveled <= maximum + 1e-7) {
    if (cursor.trackId === to.trackId && (cursor.route ?? 0) === (to.route ?? 0) && cursor.direction === to.direction) {
      const remaining = (to.distance - cursor.distance) * cursor.direction
      if (remaining >= -1e-6 && traveled + remaining <= maximum + 1e-6) return Math.max(0, traveled + remaining)
    }
    const step = Math.min(4, maximum - traveled)
    if (step <= 1e-7) break
    const next = advanceTrain(tracks, cursor, step)
    if (next.stopped) break
    cursor = next.position; traveled += step
  }
  return null
}

function dockingGeometry(tracks: Track[], e5: TrainRuntime, e6: TrainRuntime, allowLocked = false): CouplingEligibility {
  if (!e5.position || !e6.position) return no('Place both trains on the track first.')
  const first = solveConsistPoses(tracks, e6.position, e6.cabForward, e6.carCount, 'e6')
  const second = solveConsistPoses(tracks, e5.position, e5.cabForward, e5.carCount, 'e5')
  const a = first.cars.at(-1), b = second.cars[0]
  if (!a || !b || !first.cars.every(Boolean) || !second.cars.every(Boolean)) return no('Both complete trainsets must fit on the rails.')
  if (dot(a.direction, b.direction) < .9999 || Math.abs(a.pitch) > .005 || Math.abs(b.pitch) > .005)
    return no('Use a straight, nearly level section with the E5 front facing the E6 rear.')
  const mounts = { a: noseMount(a, 'e6'), b: noseMount(b, 'e5') }
  const across = { x: -a.direction.y, y: a.direction.x, z: 0 }
  const delta = { x: mounts.a.x - mounts.b.x, y: mounts.a.y - mounts.b.y, z: mounts.a.z - mounts.b.z }
  if (Math.abs(dot(delta, across)) > .2 || Math.abs(delta.z) > .2 || dot(delta, a.direction) <= 0)
    return no('The coupling ends must face each other on the same straight rails.')
  const solved = solveCoupledFormation(tracks, e6, e5)
  if (!solved.complete || !solved.e5Position) return no('The complete combined formation needs more connected track.')
  const target = { ...solved.e5Position, direction: e6.cabForward ? solved.e5Position.direction : flip(solved.e5Position.direction) }
  const from = physicalCursor(e5)!
  const gap = routeDistance(tracks, from, target, COUPLING_MAX_APPROACH_DISTANCE)
  if (gap === null) return no('Place E5 behind E6 on the same connected rails, within 200 mm of its coupling position.')
  if (!allowLocked && gap < 19 - 1e-6) return no('Leave at least 2 mm between the closed noses before coupling.')
  // Check every local rail tangent between the cabs; a bent route can end with
  // apparently aligned world-space cars while its intermediate rails curve.
  const probeStart = { ...from, direction: from.direction }
  const probeSpan = gap + 120
  for (let offset = 0; offset <= probeSpan; offset += 8) {
    const moved = advanceTrain(tracks, probeStart, offset)
    if (moved.stopped) return no('The coupling section must be connected and clear.')
    const track = tracks.find(value => value.id === moved.position.trackId)
    if (!track) return no('The coupling section must be connected and clear.')
    const point = pointAt(track, moved.position.distance, moved.position.route ?? 0)
    const direction = { x: Math.cos(point.angle) * moved.position.direction, y: Math.sin(point.angle) * moved.position.direction, z: point.slope }
    if (dot(direction, a.direction) < .9999 || Math.abs(point.slope) > .005) return no('Use a straight, nearly level coupling section.')
  }
  return { allowed: true, gap }
}

function withNose(train: TrainRuntime, state: NoseCouplingState): TrainRuntime { return { ...train, noseCoupling: state } }

export function couplingEligibility(tracks: Track[], fleet: readonly TrainRuntime[], e5Id: string, e6Id: string, groups: readonly CouplingGroup[] = []): CouplingEligibility {
  return withTrackGraph(tracks, () => {
    const e5 = fleet.find(value => value.id === e5Id), e6 = fleet.find(value => value.id === e6Id)
    if (!e5 || !e6 || e5.type !== 'e5' || e6.type !== 'e6' || e5.id === e6.id) return no('Choose one E5 and one E6 trainset.')
    if (groups.some(group => [group.e5Id, group.e6Id].includes(e5.id) || [group.e5Id, group.e6Id].includes(e6.id))) return no('Decouple the existing formation first.')
    if (!stopped(e5) || !stopped(e6)) return no('Stop both trains before coupling.')
    const geometry = dockingGeometry(tracks, e5, e6)
    if (!geometry.allowed) return geometry
    for (const state of [CLOSED, ...[.1, .15, .2, .25, .35, .5, .75, 1].map(open => ({ ...CLOSED, open })), { ...OPEN, extension: .5 }, OPEN]) {
      const a = trainFootprint(tracks, withNose(e6, state)), b = trainFootprint(tracks, withNose(e5, state))
      if (physicalTrainFootprintsConflict(a, b, [e6.carCount - 1, 0])) return no('The nose covers need more room to open safely.')
      for (const other of fleet) if (other.position && other.id !== e5Id && other.id !== e6Id) {
        const footprint = trainFootprint(tracks, other)
        if (trainFootprintsConflict(a, footprint) || trainFootprintsConflict(b, footprint)) return no(`Move ${other.name} away from the coupling area.`)
      }
    }
    // Check the entire bounded approach before opening the covers. Partner
    // shells use actual solids; all unrelated trains retain swept reserves.
    const openE6 = withNose(e6, OPEN), openE5 = withNose(e5, OPEN)
    const cursor = physicalCursor(openE5)!, partner = trainFootprint(tracks, openE6)
    let previous = trainFootprint(tracks, openE5)
    const total = geometry.gap ?? 0
    for (let distance = Math.min(2, total); distance <= total + 1e-7; distance = Math.min(distance + 2, total)) {
      const advanced = advanceTrain(tracks, cursor, distance)
      const candidate = { ...openE5, position: { ...advanced.position, direction: e5.cabForward ? advanced.position.direction : flip(advanced.position.direction) } }
      const footprint = trainFootprint(tracks, candidate)
      if (advanced.stopped || !footprint.complete || trainFootprintOverlapsItself(footprint) || physicalTrainFootprintsConflict(partner, footprint, [e6.carCount - 1, 0])) return no('The train bodies or nose covers would touch during the approach.')
      for (const other of fleet) if (other.position && other.id !== e5Id && other.id !== e6Id) {
        const occupied = trainFootprint(tracks, other)
        if (sweptTrainFootprintsConflict(previous, footprint, occupied, occupied)) return no(`Move ${other.name} away from the approach route.`)
      }
      previous = footprint
      if (distance >= total - 1e-7) break
    }
    const target = solveCoupledFormation(tracks, e6, e5)
    const coupledE5 = { ...openE5, position: target.e5Position, cabForward: e6.cabForward }
    const validity = validateCoupledFleet(tracks, [openE6, coupledE5, ...fleet.filter(train => train.id !== e5Id && train.id !== e6Id)], [...groups, { id: 'candidate-group', e5Id, e6Id }])
    return validity.allowed ? geometry : validity
  })
}

function matchingPair(fleet: readonly TrainRuntime[], group: CouplingGroup): { e6: TrainRuntime; e5: TrainRuntime } | null {
  const e6 = fleet.find(value => value.id === group.e6Id), e5 = fleet.find(value => value.id === group.e5Id)
  return e6?.type === 'e6' && e5?.type === 'e5' && e6.position && e5.position ? { e6, e5 } : null
}

function jointNoseStates(tracks: Track[], e6: TrainRuntime, e5: TrainRuntime): [NoseCouplingState, NoseCouplingState] {
  const solved = solveCoupledFormation(tracks, e6, e5), a = solved.e6.cars.at(-1), b = solved.e5.cars[0]
  if (!solved.joint || !a || !b) return [LOCKED, LOCKED]
  const axis = (car: NonNullable<typeof a>, outward: PoseVector, sign: number) => {
    const f = car.direction, horizontal = Math.hypot(f.x, f.y), r = { x: -f.y / horizontal, y: f.x / horizontal, z: 0 }
    const up = { x: -f.z * r.y, y: f.z * r.x, z: horizontal }
    return { x: sign * dot(outward, f), y: dot(outward, up), z: sign * dot(outward, r) }
  }
  const d = solved.joint.direction
  return [{ ...LOCKED, axis: axis(a, d, -1) }, { ...LOCKED, axis: axis(b, { x: -d.x, y: -d.y, z: -d.z }, 1) }]
}

function formationFootprint(tracks: Track[], e6: TrainRuntime, e5: TrainRuntime): TrainFootprint {
  const solved = solveCoupledFormation(tracks, e6, e5), states = jointNoseStates(tracks, e6, e5)
  return combineTrainFootprints(trainFootprintFromPoses(withNose(e6, states[0]), solved.e6), trainFootprintFromPoses(withNose(e5, states[1]), solved.e5), e6.carCount,
    [e6.carCount - 1, e6.carCount], solved.rearOffset)
}

export function synchronizeCoupledFleet(tracks: Track[], fleet: readonly TrainRuntime[], groups: readonly CouplingGroup[]): TrainRuntime[] {
  const result: TrainRuntime[] = fleet.map(train => ({ ...train, noseCoupling: train.noseCoupling ?? CLOSED }))
  for (const group of groups) {
    const pair = matchingPair(result, group)
    if (!pair) continue
    const solved = solveCoupledFormation(tracks, pair.e6, pair.e5)
    const first = result.findIndex(train => train.id === group.e6Id), second = result.findIndex(train => train.id === group.e5Id)
    const states = jointNoseStates(tracks, pair.e6, pair.e5)
    result[first] = withNose(pair.e6, states[0])
    result[second] = { ...withNose(pair.e5, states[1]), position: solved.e5Position, cabForward: pair.e6.cabForward,
      requestedSpeed: pair.e6.requestedSpeed, actualSpeed: pair.e6.actualSpeed, running: pair.e6.running, status: pair.e6.status,
      stopReason: pair.e6.stopReason, reverseRequested: pair.e6.reverseRequested, lapProgress: pair.e6.lapProgress }
  }
  return result
}

export function validateCoupledFleet(tracks: Track[], fleet: readonly TrainRuntime[], groups: readonly CouplingGroup[]): CouplingEligibility {
  return withTrackGraph(tracks, () => {
    const members = new Set<string>(), footprints: { id: string; footprint: TrainFootprint }[] = []
    for (const group of groups) {
      const pair = matchingPair(fleet, group)
      if (!pair || members.has(group.e6Id) || members.has(group.e5Id)) return no('A coupled formation needs one uniquely assigned E5 and E6.')
      members.add(group.e6Id); members.add(group.e5Id)
      const solved = solveCoupledFormation(tracks, pair.e6, pair.e5), footprint = formationFootprint(tracks, pair.e6, pair.e5)
      if (!solved.complete || !solved.e5Position || !footprint.complete || !sampleBehind(tracks, physicalCursor(pair.e6)!, solved.rearOffset)) return no('The complete coupled formation does not fit on the rails.')
      if (trainFootprintOverlapsItself(footprint)) return no('The coupled cars would touch. Use a larger curve, gentler slope, or longer loop.')
      footprints.push({ id: group.id, footprint })
    }
    for (const train of fleet) if (train.position && !members.has(train.id)) footprints.push({ id: train.id, footprint: trainFootprint(tracks, train) })
    for (let first = 0; first < footprints.length; first++) for (let second = first + 1; second < footprints.length; second++) {
      if (trainFootprintsConflict(footprints[first].footprint, footprints[second].footprint)) return no('The formation needs clearance from other trains.')
    }
    return { allowed: true }
  })
}

export function advanceCoupledFormation(tracks: Track[], e6: TrainRuntime, e5: TrainRuntime, distance: number): { e6: TrainRuntime; e5: TrainRuntime; stopped: boolean } {
  if (!e6.position || !(distance > 0)) {
    const solved = solveCoupledFormation(tracks, e6, e5)
    return { e6, e5: { ...e5, position: solved.e5Position, cabForward: e6.cabForward }, stopped: !solved.complete }
  }
  const initial = solveCoupledFormation(tracks, e6, e5)
  const reference = physicalCursor(e6)!
  const includeTail = sampleBehind(tracks, reference, initial.rearOffset) !== null
  const evaluate = (travel: number) => {
    const advanced = advanceConsist(tracks, e6.position!, travel, e6.cabForward, e6.carCount, 'e6')
    const leader = { ...e6, position: advanced.position }, solved = solveCoupledFormation(tracks, leader, e5)
    const fits = solved.complete && (!includeTail || e6.cabForward || sampleBehind(tracks, physicalCursor(leader)!, solved.rearOffset) !== null)
    return { leader, solved, fits, stopped: advanced.stopped }
  }
  let candidate = evaluate(distance), traveled = distance
  if (!candidate.fits) {
    let lower = 0, upper = distance
    for (let iteration = 0; iteration < 30; iteration++) { const middle = (lower + upper) / 2; if (evaluate(middle).fits) lower = middle; else upper = middle }
    traveled = lower; candidate = evaluate(lower)
  }
  const circumference = closedRouteLength(tracks, e6.position), progress = e6.lapProgress + traveled
  const lapIncrement = circumference ? Math.floor(progress / circumference) : 0
  const leader = { ...candidate.leader, position: candidate.leader.position ? { ...candidate.leader.position, laps: e6.position.laps + lapIncrement } : null,
    lapProgress: circumference ? progress % circumference : progress }
  const follower = { ...e5, position: candidate.solved.e5Position ? { ...candidate.solved.e5Position, laps: leader.position?.laps ?? 0 } : null, cabForward: e6.cabForward }
  return { e6: leader, e5: follower, stopped: candidate.stopped || traveled < distance - 1e-7 }
}

function groupedStep(tracks: Track[], fleet: readonly TrainRuntime[], groups: readonly CouplingGroup[], seconds: number): TrainRuntime[] {
  if (!groups.length) return stepFleet(tracks, fleet, seconds)
  const synced = synchronizeCoupledFleet(tracks, fleet, groups), leaders = new Map<string, TrainRuntime>()
  groups.forEach(group => { const pair = matchingPair(synced, group); if (pair) leaders.set(pair.e6.id, pair.e5) })
  const followerIds = new Set(groups.map(group => group.e5Id))
  const units = synced.filter(train => !followerIds.has(train.id))
  const updated = stepFleet(tracks, units, seconds, {
    footprint: train => { const partner = leaders.get(train.id); return partner ? formationFootprint(tracks, train, partner) : trainFootprint(tracks, train) },
    move: (train, travel) => {
      const partner = leaders.get(train.id)
      if (!partner) {
        if (!train.position || travel <= 0) return train
        const advanced = advanceConsist(tracks, train.position, travel, train.cabForward, train.carCount, train.type)
        const length = closedRouteLength(tracks, train.position), progress = train.lapProgress + travel
        return { ...train, position: { ...advanced.position, laps: train.position.laps + (length ? Math.floor(progress / length) : 0) }, lapProgress: length ? progress % length : progress,
          ...(advanced.stopped ? { actualSpeed: 0, running: false, status: 'blocked' as const, stopReason: 'End of the line! Check the connectors or reverse.' } : {}) }
      }
      const advanced = advanceCoupledFormation(tracks, train, partner, travel)
      return advanced.stopped ? { ...advanced.e6, actualSpeed: 0, running: false, status: 'blocked', stopReason: 'End of the line! The whole coupled formation needs connected track.' } : advanced.e6
    },
  })
  const byId = new Map(updated.map(train => [train.id, train]))
  return synchronizeCoupledFleet(tracks, synced.map(train => byId.get(train.id) ?? train), groups)
}

export function decouplingEligibility(tracks: Track[], fleet: readonly TrainRuntime[], group: CouplingGroup): CouplingEligibility {
  return withTrackGraph(tracks, () => {
    const pair = matchingPair(fleet, group)
    if (!pair) return no('Choose a connected E5 + E6 formation.')
    if (!stopped(pair.e5) || !stopped(pair.e6)) return no('Stop the complete formation before decoupling.')
    const geometry = dockingGeometry(tracks, pair.e5, pair.e6, true)
    if (!geometry.allowed) return geometry
    let previous = trainFootprint(tracks, withNose(pair.e5, OPEN))
    for (let travel = 2; travel <= COUPLING_SEPARATION_DISTANCE + 1; travel += 2) {
      const distance = Math.min(travel, COUPLING_SEPARATION_DISTANCE)
      const cursor = physicalCursor(pair.e5)!, reversed = { ...cursor, direction: flip(cursor.direction) }
      const moved = advanceConsist(tracks, reversed, distance, false, pair.e5.carCount, 'e5')
      const candidate = withNose({ ...pair.e5, position: { ...moved.position, direction: pair.e5.cabForward ? flip(moved.position.direction) : moved.position.direction } }, OPEN)
      const footprint = trainFootprint(tracks, candidate)
      if (moved.stopped || !footprint.complete || trainFootprintOverlapsItself(footprint)) return no('Leave 55 mm of clear, connected track behind E5 to separate.')
      for (const other of fleet) if (other.position && other.id !== pair.e5.id && other.id !== pair.e6.id) {
        const otherFootprint = trainFootprint(tracks, other)
        if (sweptTrainFootprintsConflict(previous, footprint, otherFootprint, otherFootprint)) return no(`Move ${other.name} away before separating.`)
      }
      previous = footprint
    }
    return { allowed: true, gap: COUPLING_SEPARATION_DISTANCE }
  })
}

export function beginCoupling(tracks: Track[], fleet: readonly TrainRuntime[], groups: readonly CouplingGroup[], e5Id: string, e6Id: string): CouplingOperation | null {
  if (!couplingEligibility(tracks, fleet, e5Id, e6Id, groups).allowed) return null
  return { id: `coupling-${e6Id}-${e5Id}`, e5Id, e6Id, phase: 'opening', elapsed: 0, paused: false,
    beforeTrains: fleet.map(trainSnapshot), beforeGroups: groups.map(group => ({ ...group })), separationTravel: 0 }
}

export function beginDecoupling(tracks: Track[], fleet: readonly TrainRuntime[], groups: readonly CouplingGroup[], group: CouplingGroup): CouplingOperation | null {
  if (!decouplingEligibility(tracks, fleet, group).allowed) return null
  return { id: group.id, e5Id: group.e5Id, e6Id: group.e6Id, phase: 'unlocking', elapsed: 0, paused: false,
    beforeTrains: fleet.map(trainSnapshot), beforeGroups: groups.map(value => ({ ...value })), separationTravel: 0 }
}

export function deriveNoseStates(fleet: readonly TrainRuntime[], groups: readonly CouplingGroup[], operation: CouplingOperation | null, tracks?: Track[]): Map<string, NoseCouplingState> {
  const states = new Map(fleet.map(train => [train.id, CLOSED]))
  groups.forEach(group => {
    const pair = matchingPair(fleet, group), jointStates = tracks && pair ? jointNoseStates(tracks, pair.e6, pair.e5) : [LOCKED, LOCKED]
    states.set(group.e6Id, jointStates[0]); states.set(group.e5Id, jointStates[1])
  })
  if (operation) {
    const t = operation.elapsed
    const state = operation.phase === 'opening' ? { open: Math.min(1, t / .8), extension: Math.max(0, Math.min(1, (t - .8) / .4)), locked: false }
      : operation.phase === 'closing' ? { open: Math.max(0, Math.min(1, (CLOSE_TIME - t) / .8)), extension: Math.max(0, 1 - t / .4), locked: false }
      : operation.phase === 'locking' ? { ...OPEN, locked: t >= LOCK_TIME }
      : OPEN
    states.set(operation.e6Id, state); states.set(operation.e5Id, state)
  }
  return states
}

export function stepCouplingSystem(tracks: Track[], fleet: readonly TrainRuntime[], groups: readonly CouplingGroup[], operation: CouplingOperation | null, dtSeconds: number): CouplingStep {
  return withTrackGraph(tracks, () => {
    const seconds = Math.min(.1, Math.max(0, Number.isFinite(dtSeconds) ? dtSeconds : 0))
    if (!operation) return { fleet: groupedStep(tracks, fleet, groups, seconds), groups: [...groups], operation: null }
    if (operation.paused || !seconds) return { fleet: fleet.map(train => ({ ...train })), groups: [...groups], operation }
    let op = { ...operation, elapsed: operation.elapsed + seconds }, nextGroups = [...groups]
    // A dock operation owns its two sets. Other trains retain the shared-clock
    // braking and swept safeguards against both stationary participants.
    const activeGroups = groups.filter(group => !(group.e6Id === op.e6Id && group.e5Id === op.e5Id))
    let next = groupedStep(tracks, fleet.map(train => train.id === op.e5Id || train.id === op.e6Id ? paused(train) : train), activeGroups, seconds)
    const states = deriveNoseStates(next, groups, op, tracks)
    next = next.map(train => withNose(train, states.get(train.id) ?? CLOSED))
    let e5 = next.find(train => train.id === op.e5Id), e6 = next.find(train => train.id === op.e6Id)
    if (!e5?.position || !e6?.position) return { fleet: next, groups: nextGroups, operation: { ...op, paused: true }, message: 'The coupling operation is paused because its track placement changed.' }
    const pauseOperation = (reason: string): CouplingStep => ({ fleet: next.map(train => train.id === operation.e5Id || train.id === operation.e6Id ? paused(fleet.find(previous => previous.id === train.id) ?? train) : train),
      groups: [...groups], operation: { ...operation, paused: true }, message: reason })
    if (op.phase === 'approaching' || op.phase === 'separating') {
      let travel = COUPLING_APPROACH_SPEED / 3.6 * 1000 / getTrainSpec('e5').scale * seconds
      const joining = op.phase === 'approaching'
      if (joining) {
        const geometry = dockingGeometry(tracks, e5, e6, true)
        if (!geometry.allowed) return pauseOperation(geometry.reason ?? 'The coupling alignment changed.')
        travel = Math.min(travel, geometry.gap ?? 0)
      } else travel = Math.min(travel, COUPLING_SEPARATION_DISTANCE - op.separationTravel)
      const from = physicalCursor(e5)!, movingCursor = { ...from, direction: joining ? from.direction : flip(from.direction) }
      const oldFootprint = trainFootprint(tracks, e5)
      const advanced = advanceConsist(tracks, movingCursor, travel, joining, e5.carCount, 'e5')
      const candidate = { ...e5, position: { ...advanced.position, direction: e5.cabForward ? (joining ? advanced.position.direction : flip(advanced.position.direction)) : (joining ? flip(advanced.position.direction) : advanced.position.direction) } }
      const candidateFootprint = trainFootprint(tracks, candidate)
      if (advanced.stopped || !candidateFootprint.complete || trainFootprintOverlapsItself(candidateFootprint)) return pauseOperation('The whole E5 train needs clear, connected track.')
      if (physicalTrainFootprintsConflict(trainFootprint(tracks, e6), candidateFootprint, [e6.carCount - 1, 0])) return pauseOperation('The nose covers or car bodies would touch. Move the trains to a clearer straight section.')
      for (const other of next) if (other.position && other.id !== e5.id && other.id !== e6.id) {
        const currentOther = trainFootprint(tracks, other), oldOther = fleet.find(train => train.id === other.id)
        if (sweptTrainFootprintsConflict(oldFootprint, candidateFootprint, oldOther ? trainFootprint(tracks, oldOther) : currentOther, currentOther)) return pauseOperation(`Paused safely for ${other.name}. Reload to restore the trains before this operation, then clear the coupling area.`)
      }
      e5 = candidate; next = next.map(train => train.id === e5!.id ? e5! : train)
      if (joining) {
        const remaining = dockingGeometry(tracks, e5, e6, true).gap ?? Infinity
        if (remaining < 1e-6) op = { ...op, phase: 'locking', elapsed: 0 }
      } else {
        op = { ...op, separationTravel: op.separationTravel + travel }
        if (op.separationTravel >= COUPLING_SEPARATION_DISTANCE - 1e-6) op = { ...op, phase: 'closing', elapsed: 0 }
      }
    } else {
      const a = trainFootprint(tracks, e6), b = trainFootprint(tracks, e5)
      if (physicalTrainFootprintsConflict(a, b, [e6.carCount - 1, 0])) return pauseOperation('The opening nose covers need more room.')
      for (const other of next) if (other.position && other.id !== e5.id && other.id !== e6.id) {
        const footprint = trainFootprint(tracks, other)
        if (trainFootprintsConflict(a, footprint) || trainFootprintsConflict(b, footprint)) return pauseOperation(`Paused safely for ${other.name}. Reload to restore the trains before this operation, then clear the coupling area.`)
      }
      if (op.phase === 'opening' && op.elapsed >= OPEN_TIME) op = { ...op, phase: 'approaching', elapsed: 0 }
      else if (op.phase === 'locking' && op.elapsed >= LOCK_TIME) {
        const group: CouplingGroup = { id: op.id, e5Id: op.e5Id, e6Id: op.e6Id }
        const proposed = [...nextGroups, group], valid = validateCoupledFleet(tracks, next, proposed)
        if (!valid.allowed) return pauseOperation(valid.reason ?? 'The combined formation needs more room.')
        nextGroups = proposed; next = synchronizeCoupledFleet(tracks, next.map(paused), nextGroups)
        return { fleet: next, groups: nextGroups, operation: null, message: 'E5 and E6 are coupled. Both trainsets now share the driving controls.' }
      } else if (op.phase === 'unlocking' && op.elapsed >= LOCK_TIME) {
        nextGroups = nextGroups.filter(group => group.e5Id !== op.e5Id || group.e6Id !== op.e6Id)
        op = { ...op, phase: 'separating', elapsed: 0, separationTravel: 0 }
      } else if (op.phase === 'closing' && op.elapsed >= CLOSE_TIME) {
        return { fleet: next.map(train => train.id === op.e5Id || train.id === op.e6Id ? withNose(paused(train), CLOSED) : train), groups: nextGroups, operation: null,
          message: 'The trains are separated and their nose covers are closed.' }
      }
    }
    const updatedStates = deriveNoseStates(next, nextGroups, op, tracks)
    return { fleet: next.map(train => withNose(train, updatedStates.get(train.id) ?? CLOSED)), groups: nextGroups, operation: op }
  })
}
