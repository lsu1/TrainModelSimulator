import { solveConsistPoses } from './consistPose'
import type { CarPose, PoseVector } from './consistPose'
import { COUPLING_APPROACH_SPEED, COUPLING_MAX_APPROACH_DISTANCE, COUPLING_SEPARATION_DISTANCE, noseCouplerProfile } from './couplingTypes'
import type { CabEnd, CouplingGroup, CouplingOperation, CouplingTrainType, NoseCouplingState } from './couplingTypes'
import { trainSnapshot } from './fleet'
import type { TrainRuntime } from './fleet'
import { stepFleet } from './fleetMotion'
import { noseMount, solveCoupledFormation } from './formationPose'
import { advanceConsist } from './trainMotion'
import { advanceTrain, closedRouteLength, sampleBehind, withTrackGraph } from './track'
import type { Track, TrainPosition } from './track'
import { combineTrainFootprints, physicalTrainFootprintsConflict, sweptTrainFootprintsConflict, trainFootprint, trainFootprintFromPoses, trainFootprintOverlapsItself, trainFootprintsConflict } from './trainSafety'
import type { TrainFootprint } from './trainSafety'
import { getTrainSpec } from './trains'

/** The legacy IDs now describe the stationary leader and approaching follower. */
export interface CouplingPair { e6Id: string; e5Id: string; e6End: CabEnd; e5End: CabEnd }
export interface CouplingEligibility { allowed: boolean; reason?: string; gap?: number; pair?: CouplingPair }
export interface CouplingStep { fleet: TrainRuntime[]; groups: CouplingGroup[]; operation: CouplingOperation | null; message?: string }
const CLOSED: NoseCouplingState = { open: 0, extension: 0, locked: false }
const OPEN: NoseCouplingState = { open: 1, extension: 1, locked: false }
const LOCKED: NoseCouplingState = { ...OPEN, locked: true }
/** Slow, visible cover movement; each stage uses the same timing in physics and rendering. */
export const COUPLING_OPEN_TIME = 3
export const COUPLING_CLOSE_TIME = 3
const LOCK_TIME = .5
const COVER_TIME_FRACTION = 2 / 3
const flip = (value: 1 | -1): 1 | -1 => value === 1 ? -1 : 1
const stopped = (train: TrainRuntime): boolean => !train.running && train.actualSpeed < 1e-7 && !train.reverseRequested
const physicalCursor = (train: TrainRuntime): TrainPosition | null => train.position ? { ...train.position, direction: train.cabForward ? train.position.direction : flip(train.position.direction) } : null
const dot = (a: PoseVector, b: PoseVector) => a.x * b.x + a.y * b.y + a.z * b.z
const no = (reason: string): CouplingEligibility => ({ allowed: false, reason })
const paused = (train: TrainRuntime): TrainRuntime => ({ ...train, actualSpeed: 0, running: false, status: train.position ? 'stopped' : 'unplaced', reverseRequested: false, stopReason: undefined })
const shinkansen = (train: TrainRuntime): train is TrainRuntime & { type: CouplingTrainType } => train.type !== 'e235'
const ends = (pair: Pick<CouplingGroup, 'e6End' | 'e5End'>) => ({ e6End: pair.e6End ?? 'rear' as CabEnd, e5End: pair.e5End ?? 'front' as CabEnd })
const endIndex = (train: TrainRuntime, end: CabEnd) => end === 'front' ? 0 : train.carCount - 1
const endCar = (cars: readonly (CarPose | null)[], end: CabEnd) => end === 'front' ? cars[0] : cars.at(-1)
const withNose = (train: TrainRuntime, state: NoseCouplingState): TrainRuntime => ({ ...train, noseCoupling: state })

/** Exact local route distance. Nearby parallel/elevated tracks never count as
 * the same rails, and a solution cannot skip to another lap of the railway. */
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

function dockingGeometry(tracks: Track[], follower: TrainRuntime, leader: TrainRuntime, descriptor: Pick<CouplingGroup, 'e6End' | 'e5End'>, allowLocked = false): CouplingEligibility {
  if (!follower.position || !leader.position) return no('Place both trains on the track first.')
  const selected = ends(descriptor)
  const first = solveConsistPoses(tracks, leader.position, leader.cabForward, leader.carCount, leader.type)
  const second = solveConsistPoses(tracks, follower.position, follower.cabForward, follower.carCount, follower.type)
  if (!first.cars.every(Boolean) || !second.cars.every(Boolean)) return no('Both complete trainsets must fit on the rails.')
  const solved = solveCoupledFormation(tracks, leader, follower, selected)
  if (!solved.complete || !solved.e5Position) return no('The complete combined formation needs more connected track.')
  const targetPhysical = { ...solved.e5Position, direction: solved.e5CabForward ? solved.e5Position.direction : flip(solved.e5Position.direction) }
  const from = physicalCursor(follower)!
  const approach = selected.e5End === 'front' ? from : { ...from, direction: flip(from.direction) }
  const target = selected.e5End === 'front' ? targetPhysical : { ...targetPhysical, direction: flip(targetPhysical.direction) }
  const gap = routeDistance(tracks, approach, target, COUPLING_MAX_APPROACH_DISTANCE)
  if (gap === null) return no('Place the noses near each other on the same connected rails, within 200 mm of their coupling position.')
  const a = noseCouplerProfile(leader.type)!, b = noseCouplerProfile(follower.type)!
  const closedGap = a.mountInset + b.mountInset - a.extensionLength - b.extensionLength + 2
  if (!allowLocked && gap < closedGap - 1e-6) return no('Leave a little room between the closed noses before coupling.')
  return { allowed: true, gap }
}

function matchingPair(fleet: readonly TrainRuntime[], group: CouplingGroup): { e6: TrainRuntime; e5: TrainRuntime } | null {
  const e6 = fleet.find(value => value.id === group.e6Id), e5 = fleet.find(value => value.id === group.e5Id)
  return e6 && e5 && e6.id !== e5.id && shinkansen(e6) && shinkansen(e5) && e6.position && e5.position ? { e6, e5 } : null
}

/** Articulate the short fittings toward the actual two nose mounts. This is
 * also used during approach, so a curved join never uses stale straight axes. */
function pairNoseStates(tracks: Track[], leader: TrainRuntime, follower: TrainRuntime, descriptor: Pick<CouplingGroup, 'e6End' | 'e5End'>, state: NoseCouplingState, useFormation = false): [NoseCouplingState, NoseCouplingState] {
  const selected = ends(descriptor)
  const solved = useFormation ? solveCoupledFormation(tracks, leader, follower, selected) : null
  const first = solved?.e6 ?? (leader.position ? solveConsistPoses(tracks, leader.position, leader.cabForward, leader.carCount, leader.type) : null)
  const second = solved?.e5 ?? (follower.position ? solveConsistPoses(tracks, follower.position, follower.cabForward, follower.carCount, follower.type) : null)
  const a = first && endCar(first.cars, selected.e6End), b = second && endCar(second.cars, selected.e5End)
  if (!a || !b || !shinkansen(leader) || !shinkansen(follower)) return [{ ...state, end: selected.e6End }, { ...state, end: selected.e5End }]
  const firstMount = noseMount(a, leader.type, selected.e6End), secondMount = noseMount(b, follower.type, selected.e5End)
  const span = Math.hypot(secondMount.x - firstMount.x, secondMount.y - firstMount.y, secondMount.z - firstMount.z)
  if (span < 1e-9) return [{ ...state, end: selected.e6End }, { ...state, end: selected.e5End }]
  const d = { x: (secondMount.x - firstMount.x) / span, y: (secondMount.y - firstMount.y) / span, z: (secondMount.z - firstMount.z) / span }
  const axis = (car: CarPose, outward: PoseVector, end: CabEnd) => {
    const sign = end === 'front' ? 1 : -1
    const f = car.direction, horizontal = Math.hypot(f.x, f.y), r = { x: -f.y / horizontal, y: f.x / horizontal, z: 0 }
    const up = { x: -f.z * r.y, y: f.z * r.x, z: horizontal }
    return { x: sign * dot(outward, f), y: dot(outward, up), z: sign * dot(outward, r) }
  }
  return [{ ...state, end: selected.e6End, axis: axis(a, d, selected.e6End) }, { ...state, end: selected.e5End, axis: axis(b, { x: -d.x, y: -d.y, z: -d.z }, selected.e5End) }]
}

function preparedNoses(tracks: Track[], leader: TrainRuntime, follower: TrainRuntime, descriptor: Pick<CouplingGroup, 'e6End' | 'e5End'>, state: NoseCouplingState): [TrainRuntime, TrainRuntime] {
  const states = pairNoseStates(tracks, leader, follower, descriptor, state)
  return [withNose(leader, states[0]), withNose(follower, states[1])]
}

/** Move an independent set toward its selected nose (+front, -rear), retaining
 * its original car indices and physical orientation even when travelling back. */
function moveRelative(tracks: Track[], train: TrainRuntime, distance: number, originalForward: boolean): { train: TrainRuntime; stopped: boolean } {
  if (!train.position) return { train, stopped: true }
  const physical = physicalCursor(train)!
  const cursor = originalForward ? physical : { ...physical, direction: flip(physical.direction) }
  const advanced = advanceConsist(tracks, cursor, distance, originalForward, train.carCount, train.type)
  const originalDirection = originalForward ? advanced.position.direction : flip(advanced.position.direction)
  return { train: { ...train, position: { ...advanced.position, direction: train.cabForward ? originalDirection : flip(originalDirection) } }, stopped: advanced.stopped }
}

function candidateEligibility(tracks: Track[], fleet: readonly TrainRuntime[], groups: readonly CouplingGroup[], leader: TrainRuntime, follower: TrainRuntime, pair: CouplingPair, geometry: CouplingEligibility): CouplingEligibility {
  const selected = ends(pair), mating: [number, number] = [endIndex(leader, selected.e6End), endIndex(follower, selected.e5End)]
  for (const state of [CLOSED, ...[.1, .15, .2, .25, .35, .5, .75, 1].map(open => ({ ...CLOSED, open })), { ...OPEN, extension: .5 }, OPEN]) {
    const [aTrain, bTrain] = preparedNoses(tracks, leader, follower, pair, state)
    const a = trainFootprint(tracks, aTrain), b = trainFootprint(tracks, bTrain)
    if (physicalTrainFootprintsConflict(a, b, mating)) return no('The nose covers need a little more room to open safely.')
    for (const other of fleet) if (other.position && other.id !== follower.id && other.id !== leader.id) {
      const footprint = trainFootprint(tracks, other)
      if (trainFootprintsConflict(a, footprint) || trainFootprintsConflict(b, footprint)) return no(`Move ${other.name} away from the coupling area.`)
    }
  }
  let previous = trainFootprint(tracks, preparedNoses(tracks, leader, follower, pair, OPEN)[1])
  const total = geometry.gap ?? 0
  for (let distance = Math.min(2, total); distance <= total + 1e-7; distance = Math.min(distance + 2, total)) {
    const advanced = moveRelative(tracks, follower, distance, selected.e5End === 'front')
    const [aTrain, candidate] = preparedNoses(tracks, leader, advanced.train, pair, OPEN)
    const footprint = trainFootprint(tracks, candidate)
    if (advanced.stopped || !footprint.complete || trainFootprintOverlapsItself(footprint) || physicalTrainFootprintsConflict(trainFootprint(tracks, aTrain), footprint, mating)) return no('The train bodies or nose covers would touch during the approach.')
    for (const other of fleet) if (other.position && other.id !== follower.id && other.id !== leader.id) {
      const occupied = trainFootprint(tracks, other)
      if (sweptTrainFootprintsConflict(previous, footprint, occupied, occupied)) return no(`Move ${other.name} away from the approach route.`)
    }
    previous = footprint
    if (distance >= total - 1e-7) break
  }
  const target = solveCoupledFormation(tracks, leader, follower, selected)
  const coupledFollower = { ...follower, position: target.e5Position, cabForward: target.e5CabForward }
  const validity = validateCoupledFleet(tracks, [leader, coupledFollower, ...fleet.filter(train => train.id !== follower.id && train.id !== leader.id)], [...groups, { ...pair, id: 'candidate-group' }])
  return validity.allowed ? { ...geometry, pair } : validity
}

/** Play mode supports every E5/E6/E7 pairing. Find the nearby facing end on the
 * connected route rather than asking a child to identify a train's head/tail. */
export function couplingEligibility(tracks: Track[], fleet: readonly TrainRuntime[], firstId: string, secondId: string, groups: readonly CouplingGroup[] = []): CouplingEligibility {
  return withTrackGraph(tracks, () => {
    const first = fleet.find(value => value.id === firstId), second = fleet.find(value => value.id === secondId)
    if (!first || !second || !shinkansen(first) || !shinkansen(second) || first.id === second.id) return no('Choose any two Shinkansen trainsets.')
    if (groups.some(group => [group.e5Id, group.e6Id].includes(first.id) || [group.e5Id, group.e6Id].includes(second.id))) return no('Decouple the existing formation first.')
    if (!stopped(first) || !stopped(second)) return no('Stop both trains before coupling.')
    const candidates: { leader: TrainRuntime; follower: TrainRuntime; pair: CouplingPair; geometry: CouplingEligibility }[] = []
    let reason = 'Place two Shinkansen noses near each other on connected rails.'
    for (const [leader, follower] of [[second, first], [first, second]]) {
      for (const [e6End, e5End] of [['rear', 'front'], ['front', 'rear'], ['front', 'front'], ['rear', 'rear']] as const) {
        const pair = { e6Id: leader.id, e5Id: follower.id, e6End, e5End }
        const geometry = dockingGeometry(tracks, follower, leader, pair)
        if (geometry.allowed) candidates.push({ leader, follower, pair, geometry })
        else if (geometry.reason) reason = geometry.reason
      }
    }
    candidates.sort((a, b) => Math.round((a.geometry.gap ?? Infinity) * 1e5) - Math.round((b.geometry.gap ?? Infinity) * 1e5))
    for (const candidate of candidates) {
      const allowed = candidateEligibility(tracks, fleet, groups, candidate.leader, candidate.follower, candidate.pair, candidate.geometry)
      if (allowed.allowed) return allowed
      if (allowed.reason) reason = allowed.reason
    }
    return no(reason)
  })
}

function formationFootprint(tracks: Track[], leader: TrainRuntime, follower: TrainRuntime, group: CouplingGroup): TrainFootprint {
  const selected = ends(group), solved = solveCoupledFormation(tracks, leader, follower, selected), states = pairNoseStates(tracks, leader, follower, selected, LOCKED, true)
  const footprint = combineTrainFootprints(trainFootprintFromPoses(withNose(leader, states[0]), solved.e6), trainFootprintFromPoses(withNose(follower, states[1]), solved.e5), leader.carCount,
    [endIndex(leader, selected.e6End), leader.carCount + endIndex(follower, selected.e5End)], solved.rearOffset)
  footprint.frontOffset = solved.frontOffset
  return footprint
}

export function synchronizeCoupledFleet(tracks: Track[], fleet: readonly TrainRuntime[], groups: readonly CouplingGroup[]): TrainRuntime[] {
  const result: TrainRuntime[] = fleet.map(train => ({ ...train, noseCoupling: train.noseCoupling ?? CLOSED }))
  for (const group of groups) {
    const pair = matchingPair(result, group)
    if (!pair) continue
    const solved = solveCoupledFormation(tracks, pair.e6, pair.e5, group)
    const first = result.findIndex(train => train.id === group.e6Id), second = result.findIndex(train => train.id === group.e5Id)
    const states = pairNoseStates(tracks, pair.e6, pair.e5, group, LOCKED, true)
    const maximum = Math.min(getTrainSpec(pair.e6.type).maxServiceSpeed, getTrainSpec(pair.e5.type).maxServiceSpeed)
    const requestedSpeed = Math.min(maximum, pair.e6.requestedSpeed), actualSpeed = Math.min(maximum, pair.e6.actualSpeed)
    result[first] = { ...withNose(pair.e6, states[0]), requestedSpeed, actualSpeed }
    result[second] = { ...withNose(pair.e5, states[1]), position: solved.e5Position, cabForward: solved.e5CabForward,
      requestedSpeed, actualSpeed, running: pair.e6.running, status: pair.e6.status,
      stopReason: pair.e6.stopReason, reverseRequested: pair.e6.reverseRequested, lapProgress: pair.e6.lapProgress }
  }
  return result
}

export function validateCoupledFleet(tracks: Track[], fleet: readonly TrainRuntime[], groups: readonly CouplingGroup[]): CouplingEligibility {
  return withTrackGraph(tracks, () => {
    const members = new Set<string>(), footprints: { id: string; footprint: TrainFootprint }[] = []
    for (const group of groups) {
      const pair = matchingPair(fleet, group)
      if (!pair || members.has(group.e6Id) || members.has(group.e5Id)) return no('A formation needs two uniquely assigned Shinkansen trainsets.')
      members.add(group.e6Id); members.add(group.e5Id)
      const solved = solveCoupledFormation(tracks, pair.e6, pair.e5, group), footprint = formationFootprint(tracks, pair.e6, pair.e5, group)
      const reference = physicalCursor(pair.e6)!, ahead = { ...reference, direction: flip(reference.direction) }
      if (!solved.complete || !solved.e5Position || !footprint.complete || !sampleBehind(tracks, reference, solved.rearOffset) || !sampleBehind(tracks, ahead, solved.frontOffset)) return no('The complete coupled formation does not fit on the rails.')
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

export function advanceCoupledFormation(tracks: Track[], leader: TrainRuntime, follower: TrainRuntime, distance: number, group: Pick<CouplingGroup, 'e6End' | 'e5End'> = {}): { e6: TrainRuntime; e5: TrainRuntime; stopped: boolean } {
  if (!leader.position || !(distance > 0)) {
    const solved = solveCoupledFormation(tracks, leader, follower, group)
    return { e6: leader, e5: { ...follower, position: solved.e5Position, cabForward: solved.e5CabForward }, stopped: !solved.complete }
  }
  const initial = solveCoupledFormation(tracks, leader, follower, group), reference = physicalCursor(leader)!
  const includeTail = sampleBehind(tracks, reference, initial.rearOffset) !== null
  const includeFront = sampleBehind(tracks, { ...reference, direction: flip(reference.direction) }, initial.frontOffset) !== null
  const evaluate = (travel: number) => {
    const advanced = advanceConsist(tracks, leader.position!, travel, leader.cabForward, leader.carCount, leader.type)
    const moved = { ...leader, position: advanced.position }, solved = solveCoupledFormation(tracks, moved, follower, group), physical = physicalCursor(moved)!
    const fits = solved.complete && (!includeTail || sampleBehind(tracks, physical, solved.rearOffset) !== null)
      && (!includeFront || sampleBehind(tracks, { ...physical, direction: flip(physical.direction) }, solved.frontOffset) !== null)
    return { leader: moved, solved, fits, stopped: advanced.stopped }
  }
  let candidate = evaluate(distance), traveled = distance
  if (!candidate.fits) {
    let lower = 0, upper = distance
    for (let iteration = 0; iteration < 30; iteration++) { const middle = (lower + upper) / 2; if (evaluate(middle).fits) lower = middle; else upper = middle }
    traveled = lower; candidate = evaluate(lower)
  }
  const circumference = closedRouteLength(tracks, leader.position), progress = leader.lapProgress + traveled
  const lapIncrement = circumference ? Math.floor(progress / circumference) : 0
  const moved = { ...candidate.leader, position: candidate.leader.position ? { ...candidate.leader.position, laps: leader.position.laps + lapIncrement } : null,
    lapProgress: circumference ? progress % circumference : progress }
  const followed = { ...follower, position: candidate.solved.e5Position ? { ...candidate.solved.e5Position, laps: moved.position?.laps ?? 0 } : null, cabForward: candidate.solved.e5CabForward }
  return { e6: moved, e5: followed, stopped: candidate.stopped || traveled < distance - 1e-7 }
}

function groupedStep(tracks: Track[], fleet: readonly TrainRuntime[], groups: readonly CouplingGroup[], seconds: number): TrainRuntime[] {
  if (!groups.length) return stepFleet(tracks, fleet, seconds)
  const synced = synchronizeCoupledFleet(tracks, fleet, groups), leaders = new Map<string, { follower: TrainRuntime; group: CouplingGroup }>()
  groups.forEach(group => { const pair = matchingPair(synced, group); if (pair) leaders.set(pair.e6.id, { follower: pair.e5, group }) })
  const followerIds = new Set(groups.map(group => group.e5Id))
  const units = synced.filter(train => !followerIds.has(train.id))
  const updated = stepFleet(tracks, units, seconds, {
    footprint: train => { const partner = leaders.get(train.id); return partner ? formationFootprint(tracks, train, partner.follower, partner.group) : trainFootprint(tracks, train) },
    move: (train, travel) => {
      const partner = leaders.get(train.id)
      if (!partner) {
        if (!train.position || travel <= 0) return train
        const advanced = advanceConsist(tracks, train.position, travel, train.cabForward, train.carCount, train.type)
        const length = closedRouteLength(tracks, train.position), progress = train.lapProgress + travel
        return { ...train, position: { ...advanced.position, laps: train.position.laps + (length ? Math.floor(progress / length) : 0) }, lapProgress: length ? progress % length : progress,
          ...(advanced.stopped ? { actualSpeed: 0, running: false, status: 'blocked' as const, stopReason: 'End of the line! Check the connectors or reverse.' } : {}) }
      }
      const advanced = advanceCoupledFormation(tracks, train, partner.follower, travel, partner.group)
      return advanced.stopped ? { ...advanced.e6, actualSpeed: 0, running: false, status: 'blocked', stopReason: 'End of the line! The whole coupled formation needs connected track.' } : advanced.e6
    },
  })
  const byId = new Map(updated.map(train => [train.id, train]))
  return synchronizeCoupledFleet(tracks, synced.map(train => byId.get(train.id) ?? train), groups)
}

export function decouplingEligibility(tracks: Track[], fleet: readonly TrainRuntime[], group: CouplingGroup): CouplingEligibility {
  return withTrackGraph(tracks, () => {
    const pair = matchingPair(fleet, group)
    if (!pair) return no('Choose a connected Shinkansen formation.')
    if (!stopped(pair.e5) || !stopped(pair.e6)) return no('Stop the complete formation before decoupling.')
    const selected = ends(group), mating: [number, number] = [endIndex(pair.e6, selected.e6End), endIndex(pair.e5, selected.e5End)]
    let previous = trainFootprint(tracks, preparedNoses(tracks, pair.e6, pair.e5, group, OPEN)[1])
    for (let travel = 2; travel <= COUPLING_SEPARATION_DISTANCE + 1; travel += 2) {
      const distance = Math.min(travel, COUPLING_SEPARATION_DISTANCE)
      const moved = moveRelative(tracks, pair.e5, distance, selected.e5End !== 'front')
      const [leader, candidate] = preparedNoses(tracks, pair.e6, moved.train, group, OPEN)
      const footprint = trainFootprint(tracks, candidate)
      if (moved.stopped || !footprint.complete || trainFootprintOverlapsItself(footprint) || physicalTrainFootprintsConflict(trainFootprint(tracks, leader), footprint, mating)) return no('Leave 55 mm of clear, connected track beside the separating train.')
      for (const other of fleet) if (other.position && other.id !== pair.e5.id && other.id !== pair.e6.id) {
        const otherFootprint = trainFootprint(tracks, other)
        if (sweptTrainFootprintsConflict(previous, footprint, otherFootprint, otherFootprint)) return no(`Move ${other.name} away before separating.`)
      }
      previous = footprint
    }
    const separated = moveRelative(tracks, pair.e5, COUPLING_SEPARATION_DISTANCE, selected.e5End !== 'front').train
    for (const state of [OPEN, { ...OPEN, extension: .5 }, { ...OPEN, extension: 0 }, ...[.75, .5, .25, .1, 0].map(open => ({ ...CLOSED, open }))]) {
      const [leader, follower] = preparedNoses(tracks, pair.e6, separated, group, state)
      if (physicalTrainFootprintsConflict(trainFootprint(tracks, leader), trainFootprint(tracks, follower), mating)) return no('The nose covers need more room to close safely.')
    }
    return { allowed: true, gap: COUPLING_SEPARATION_DISTANCE }
  })
}

export function beginCoupling(tracks: Track[], fleet: readonly TrainRuntime[], groups: readonly CouplingGroup[], firstId: string, secondId: string): CouplingOperation | null {
  const eligibility = couplingEligibility(tracks, fleet, firstId, secondId, groups)
  if (!eligibility.allowed || !eligibility.pair) return null
  return { id: `coupling-${eligibility.pair.e6Id}-${eligibility.pair.e5Id}`, ...eligibility.pair, phase: 'opening', elapsed: 0, paused: false,
    beforeTrains: fleet.map(trainSnapshot), beforeGroups: groups.map(group => ({ ...group })), separationTravel: 0 }
}

export function beginDecoupling(tracks: Track[], fleet: readonly TrainRuntime[], groups: readonly CouplingGroup[], group: CouplingGroup): CouplingOperation | null {
  if (!decouplingEligibility(tracks, fleet, group).allowed) return null
  return { id: group.id, e5Id: group.e5Id, e6Id: group.e6Id, ...ends(group), phase: 'unlocking', elapsed: 0, paused: false,
    beforeTrains: fleet.map(trainSnapshot), beforeGroups: groups.map(value => ({ ...value })), separationTravel: 0 }
}

export function deriveNoseStates(fleet: readonly TrainRuntime[], groups: readonly CouplingGroup[], operation: CouplingOperation | null, tracks?: Track[]): Map<string, NoseCouplingState> {
  const states = new Map(fleet.map(train => [train.id, CLOSED]))
  groups.forEach(group => {
    const pair = matchingPair(fleet, group), selected = ends(group)
    const jointStates = tracks && pair ? pairNoseStates(tracks, pair.e6, pair.e5, selected, LOCKED, true) : [{ ...LOCKED, end: selected.e6End }, { ...LOCKED, end: selected.e5End }]
    states.set(group.e6Id, jointStates[0]); states.set(group.e5Id, jointStates[1])
  })
  if (operation) {
    const t = operation.elapsed, openingCover = COUPLING_OPEN_TIME * COVER_TIME_FRACTION, openingExtension = COUPLING_OPEN_TIME - openingCover
    const closingExtension = COUPLING_CLOSE_TIME * (1 - COVER_TIME_FRACTION), closingCover = COUPLING_CLOSE_TIME - closingExtension
    const state = operation.phase === 'opening' ? { open: Math.min(1, t / openingCover), extension: Math.max(0, Math.min(1, (t - openingCover) / openingExtension)), locked: false }
      : operation.phase === 'closing' ? { open: Math.max(0, Math.min(1, (COUPLING_CLOSE_TIME - t) / closingCover)), extension: Math.max(0, 1 - t / closingExtension), locked: false }
      : operation.phase === 'locking' ? { ...OPEN, locked: t >= LOCK_TIME }
      : OPEN
    const pair = matchingPair(fleet, operation), selected = ends(operation)
    const pairStates = tracks && pair ? pairNoseStates(tracks, pair.e6, pair.e5, selected, state) : [{ ...state, end: selected.e6End }, { ...state, end: selected.e5End }]
    states.set(operation.e6Id, pairStates[0]); states.set(operation.e5Id, pairStates[1])
  }
  return states
}

export function stepCouplingSystem(tracks: Track[], fleet: readonly TrainRuntime[], groups: readonly CouplingGroup[], operation: CouplingOperation | null, dtSeconds: number): CouplingStep {
  return withTrackGraph(tracks, () => {
    const seconds = Math.min(.1, Math.max(0, Number.isFinite(dtSeconds) ? dtSeconds : 0))
    if (!operation) return { fleet: groupedStep(tracks, fleet, groups, seconds), groups: [...groups], operation: null }
    if (operation.paused || !seconds) return { fleet: fleet.map(train => ({ ...train })), groups: [...groups], operation }
    let op = { ...operation, elapsed: operation.elapsed + seconds }, nextGroups = [...groups]
    const selected = ends(op)
    const activeGroups = groups.filter(group => !(group.e6Id === op.e6Id && group.e5Id === op.e5Id))
    let next = groupedStep(tracks, fleet.map(train => train.id === op.e5Id || train.id === op.e6Id ? paused(train) : train), activeGroups, seconds)
    const states = deriveNoseStates(next, groups, op, tracks)
    next = next.map(train => withNose(train, states.get(train.id) ?? CLOSED))
    let follower = next.find(train => train.id === op.e5Id), leader = next.find(train => train.id === op.e6Id)
    if (!follower?.position || !leader?.position) return { fleet: next, groups: nextGroups, operation: { ...op, paused: true }, message: 'The coupling operation is paused because its track placement changed.' }
    const mating: [number, number] = [endIndex(leader, selected.e6End), endIndex(follower, selected.e5End)]
    const pauseOperation = (reason: string): CouplingStep => ({ fleet: next.map(train => train.id === operation.e5Id || train.id === operation.e6Id ? paused(fleet.find(previous => previous.id === train.id) ?? train) : train),
      groups: [...groups], operation: { ...operation, paused: true }, message: reason })
    if (op.phase === 'approaching' || op.phase === 'separating') {
      let travel = COUPLING_APPROACH_SPEED / 3.6 * 1000 / getTrainSpec(follower.type).scale * seconds
      const joining = op.phase === 'approaching'
      if (joining) {
        const geometry = dockingGeometry(tracks, follower, leader, op, true)
        if (!geometry.allowed) return pauseOperation(geometry.reason ?? 'The coupling alignment changed.')
        travel = Math.min(travel, geometry.gap ?? 0)
      } else travel = Math.min(travel, COUPLING_SEPARATION_DISTANCE - op.separationTravel)
      const oldFootprint = trainFootprint(tracks, follower)
      const advanced = moveRelative(tracks, follower, travel, joining ? selected.e5End === 'front' : selected.e5End !== 'front')
      const prepared = preparedNoses(tracks, leader, advanced.train, op, OPEN)
      const candidate = prepared[1], candidateFootprint = trainFootprint(tracks, candidate)
      if (advanced.stopped || !candidateFootprint.complete || trainFootprintOverlapsItself(candidateFootprint)) return pauseOperation('The whole train needs clear, connected track.')
      if (physicalTrainFootprintsConflict(trainFootprint(tracks, prepared[0]), candidateFootprint, mating)) return pauseOperation('The nose covers or car bodies would touch. Move the trains to a clearer section.')
      for (const other of next) if (other.position && other.id !== follower.id && other.id !== leader.id) {
        const currentOther = trainFootprint(tracks, other), oldOther = fleet.find(train => train.id === other.id)
        if (sweptTrainFootprintsConflict(oldFootprint, candidateFootprint, oldOther ? trainFootprint(tracks, oldOther) : currentOther, currentOther)) return pauseOperation(`Paused safely for ${other.name}. Clear the coupling area before continuing.`)
      }
      follower = candidate; leader = prepared[0]
      next = next.map(train => train.id === follower!.id ? follower! : train.id === leader!.id ? leader! : train)
      if (joining) {
        const remaining = dockingGeometry(tracks, follower, leader, op, true).gap ?? Infinity
        if (remaining < 1e-6) op = { ...op, phase: 'locking', elapsed: 0 }
      } else {
        op = { ...op, separationTravel: op.separationTravel + travel }
        if (op.separationTravel >= COUPLING_SEPARATION_DISTANCE - 1e-6) op = { ...op, phase: 'closing', elapsed: 0 }
      }
    } else {
      const a = trainFootprint(tracks, leader), b = trainFootprint(tracks, follower)
      if (physicalTrainFootprintsConflict(a, b, mating)) return pauseOperation('The opening nose covers need more room.')
      for (const other of next) if (other.position && other.id !== follower.id && other.id !== leader.id) {
        const footprint = trainFootprint(tracks, other)
        if (trainFootprintsConflict(a, footprint) || trainFootprintsConflict(b, footprint)) return pauseOperation(`Paused safely for ${other.name}. Clear the coupling area before continuing.`)
      }
      if (op.phase === 'opening' && op.elapsed >= COUPLING_OPEN_TIME) op = { ...op, phase: 'approaching', elapsed: 0 }
      else if (op.phase === 'locking' && op.elapsed >= LOCK_TIME) {
        const group: CouplingGroup = { id: op.id, e5Id: op.e5Id, e6Id: op.e6Id, ...selected }
        const proposed = [...nextGroups, group], valid = validateCoupledFleet(tracks, next, proposed)
        if (!valid.allowed) return pauseOperation(valid.reason ?? 'The combined formation needs more room.')
        nextGroups = proposed; next = synchronizeCoupledFleet(tracks, next.map(paused), nextGroups)
        return { fleet: next, groups: nextGroups, operation: null, message: 'The Shinkansen are coupled. Both trainsets now share the driving controls.' }
      } else if (op.phase === 'unlocking' && op.elapsed >= LOCK_TIME) {
        nextGroups = nextGroups.filter(group => group.e5Id !== op.e5Id || group.e6Id !== op.e6Id)
        op = { ...op, phase: 'separating', elapsed: 0, separationTravel: 0 }
      } else if (op.phase === 'closing' && op.elapsed >= COUPLING_CLOSE_TIME) {
        return { fleet: next.map(train => train.id === op.e5Id || train.id === op.e6Id ? withNose(paused(train), CLOSED) : train), groups: nextGroups, operation: null,
          message: 'The trains are separated and their nose covers are closed.' }
      }
    }
    const updatedStates = deriveNoseStates(next, nextGroups, op, tracks)
    return { fleet: next.map(train => withNose(train, updatedStates.get(train.id) ?? CLOSED)), groups: nextGroups, operation: op }
  })
}
