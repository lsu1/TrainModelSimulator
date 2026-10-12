import { E235_ENGINEERING_DATA, KATO_CATALOG } from './catalog'
import { auditClearances } from './clearance'
import { fleetTrainTypes } from './fleet'
import { getLayoutPieceLimit } from './layout'
import type { LayoutData } from './layout'
import { attachTrack, closedRouteLength, connectedEndpoint, endpoints, pathsFor, SNAP_ANGLE, SNAP_DISTANCE, SNAP_HEIGHT, withTrackGraph } from './track'
import type { Endpoint, Track } from './track'
import { getTrainSpec } from './trains'
import { TRACK_HELPER_LIMITS } from './trackHelperTypes'
import type { TrackEndRef, TrackHelperInspection, TrackHelperRequest, TrackHelperResult, TrackHelperSolution } from './trackHelperTypes'

export { TRACK_HELPER_LIMITS } from './trackHelperTypes'
export type { TrackEndRef, TrackHelperInspection, TrackHelperRequest, TrackHelperResult, TrackHelperSolution } from './trackHelperTypes'

const ITEMS = new Map(KATO_CATALOG.map(item => [item.kind, item]))
const ANGLE_STEP = Math.PI / 12
const difference = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b))
const sameRef = (a: TrackEndRef, b: TrackEndRef) => a.trackId === b.trackId && a.end === b.end
const height = (endpoint: Endpoint) => endpoint.position.z ?? 0

function endpointFor(layout: LayoutData, ref: TrackEndRef): Endpoint | undefined {
  const track = layout.tracks.find(track => track.id === ref.trackId)
  return track && Number.isInteger(ref.end) && ref.end >= 0 ? endpoints(track)[ref.end] : undefined
}

function singleTrackEnd(layout: LayoutData, ref: TrackEndRef): boolean {
  const item = ITEMS.get(layout.tracks.find(track => track.id === ref.trackId)?.kind ?? '')
  return !!item && (item.lanes ?? 1) === 1 && !['doubleStraight', 'doubleCurve', 'scissors'].includes(item.shape)
}

/** Inspection is deliberately cheap: it does not run the combinatorial search. */
export function inspectTrackFeasibility(layout: LayoutData, ends: [TrackEndRef, TrackEndRef]): TrackHelperInspection {
  let a: Endpoint | undefined, b: Endpoint | undefined
  try { a = endpointFor(layout, ends[0]); b = endpointFor(layout, ends[1]) } catch { /* Invalid imported geometry cannot become a suggestion. */ }
  const missing = !a || !b || sameRef(ends[0], ends[1])
    || ![a.position.x, a.position.y, height(a), a.angle, b.position.x, b.position.y, height(b), b.angle].every(Number.isFinite)
  const gap = missing ? 0 : Math.hypot(a!.position.x - b!.position.x, a!.position.y - b!.position.y)
  const angleDifference = missing ? 0 : Math.abs(difference(a!.angle, b!.angle + Math.PI))
  const heightDifference = missing ? 0 : Math.abs(height(a!) - height(b!))
  let message = 'Choose two different open track ends.'
  let eligible = false
  if (!missing) {
    if (!singleTrackEnd(layout, ends[0]) || !singleTrackEnd(layout, ends[1])) {
      message = 'This helper finishes single-track connections. Keep building double track or scissors crossovers manually.'
    } else if (connectedEndpoint(layout.tracks, ends[0].trackId, ends[0].end) || connectedEndpoint(layout.tracks, ends[1].trackId, ends[1].end)) {
      message = 'One of these ends is already connected. Choose two open ends.'
    } else if (gap > TRACK_HELPER_LIMITS.gap) {
      message = `Bring these ends within ${TRACK_HELPER_LIMITS.gap} mm before checking. They are ${Math.round(gap)} mm apart.`
    } else if (heightDifference > SNAP_HEIGHT) {
      message = `One end is ${heightDifference.toFixed(1)} mm higher. Bring both ends to the same height first.`
    } else {
      eligible = true
      message = 'Ready to check up to six flat finishing pieces, with small repairs near these ends.'
    }
  }
  return { eligible, message, gap, angleDifference, heightDifference }
}

interface Candidate { kind: string; bend: 1 | -1; dx: number; dy: number; turn: number; length: number; samples: { x: number; y: number }[] }
interface State { x: number; y: number; angle: number; sequence: Candidate[] }
interface Variant { removeIds: string[]; anchors: [TrackEndRef, TrackEndRef] }
interface Budget { used: number; limit: number }
interface Bounds { minX: number; maxX: number; minY: number; maxY: number }

function minimumRadius(layout: LayoutData): number {
  return Math.max(0, ...fleetTrainTypes(layout).map(type => getTrainSpec(type).minimumRadius ?? 0))
}

function finishingItem(item: typeof KATO_CATALOG[number]): boolean {
  return ['straight', 'curve'].includes(item.shape) && ['ballast', 'viaduct'].includes(item.bed)
    && !item.kind.includes('-buffer-')
}

/** Cosmetic versions are one geometry choice. Keep existing dimensions, and
 * prefer ordinary ballast on the table or matching viaduct geometry above it.
 * The E235 recommendation affects ordering, never eligibility. */
function candidatesFor(layout: LayoutData, elevation: number): Candidate[] {
  const groups = new Map<string, typeof KATO_CATALOG[number]>()
  const minimum = minimumRadius(layout)
  const preference = (bed: string) => bed === (elevation > SNAP_HEIGHT ? 'viaduct' : 'ballast') ? 0 : 1
  for (const item of KATO_CATALOG) {
    if (!finishingItem(item)
      || (item.radius !== undefined && item.radius < minimum)) continue
    const key = item.shape === 'straight' ? `s:${item.length}` : `c:${item.radius}:${item.angle}`
    const existing = groups.get(key)
    if (!existing || preference(item.bed) < preference(existing.bed)) groups.set(key, item)
  }
  const items = [...groups.values()].sort((a, b) => {
    const recommended = E235_ENGINEERING_DATA.recommendedRadiusMm
    const aRank = a.shape === 'straight' ? 0 : a.radius! >= recommended ? 1 : 2
    const bRank = b.shape === 'straight' ? 0 : b.radius! >= recommended ? 1 : 2
    return aRank - bRank || (a.shape === 'straight' ? b.length - a.length : a.radius! - b.radius! || a.angle! - b.angle!)
      || a.kind.localeCompare(b.kind, 'en')
  })
  return items.flatMap(item => (item.shape === 'straight' ? [1 as const] : [1 as const, -1 as const]).map(bend => {
    const turn = item.shape === 'straight' ? 0 : bend * item.angle!
    const dx = item.shape === 'straight' ? item.length : item.radius! * Math.sin(item.angle!)
    const dy = item.shape === 'straight' ? 0 : bend * item.radius! * (1 - Math.cos(item.angle!))
    const samples = [{ x: 0, y: 0 }, { x: dx, y: dy }]
    // Including every cardinal tangent gives exact, rather than sampled, arc bounds.
    for (let quadrant = -1; quadrant <= 1; quadrant++) {
      const tangent = quadrant * Math.PI / 2
      if (tangent > Math.min(0, turn) && tangent < Math.max(0, turn)) samples.push({
        x: bend * item.radius! * Math.sin(tangent), y: bend * item.radius! * (1 - Math.cos(tangent)),
      })
    }
    return { kind: item.kind, bend, dx, dy, turn, length: item.length, samples }
  }))
}

function boundsFor(a: Endpoint, b: Endpoint): Bounds {
  return {
    minX: Math.min(a.position.x, b.position.x) - TRACK_HELPER_LIMITS.margin,
    maxX: Math.max(a.position.x, b.position.x) + TRACK_HELPER_LIMITS.margin,
    minY: Math.min(a.position.y, b.position.y) - TRACK_HELPER_LIMITS.margin,
    maxY: Math.max(a.position.y, b.position.y) + TRACK_HELPER_LIMITS.margin,
  }
}

function removable(track: Track): boolean {
  const item = ITEMS.get(track.kind)
  return !!item && (item.shape === 'straight' || item.shape === 'curve')
    && Math.abs((track.endElevation ?? track.elevation ?? 0) - (track.elevation ?? 0)) < 1e-8
}

function terminalChain(layout: LayoutData, end: TrackEndRef, protectedIds: Set<string>): { ids: string[]; anchor: TrackEndRef }[] {
  const result = [{ ids: [] as string[], anchor: end }]
  const byId = new Map(layout.tracks.map(track => [track.id, track]))
  let anchor = end
  const ids: string[] = []
  for (let count = 0; count < TRACK_HELPER_LIMITS.repairPieces; count++) {
    const track = byId.get(anchor.trackId)
    if (!track || !removable(track) || protectedIds.has(track.id) || ids.includes(track.id) || anchor.end > 1) break
    const connection = connectedEndpoint(layout.tracks, track.id, 1 - anchor.end)
    if (!connection || ids.includes(connection.track.id)) break
    const back = connectedEndpoint(layout.tracks, connection.track.id, connection.end)
    if (back?.track.id !== track.id || back.end !== 1 - anchor.end) break
    ids.push(track.id)
    anchor = { trackId: connection.track.id, end: connection.end }
    result.push({ ids: [...ids], anchor })
  }
  return result
}

function variantsFor(layout: LayoutData, ends: [TrackEndRef, TrackEndRef], protectedIds: Set<string>): Variant[] {
  return withTrackGraph(layout.tracks, () => {
    const a = terminalChain(layout, ends[0], protectedIds), b = terminalChain(layout, ends[1], protectedIds)
    const variants: Variant[] = []
    for (let total = 0; total <= TRACK_HELPER_LIMITS.repairPieces; total++) for (let left = 0; left <= total; left++) {
      const right = total - left
      if (!a[left] || !b[right]) continue
      const ids = [...a[left].ids, ...b[right].ids]
      if (new Set(ids).size !== ids.length || ids.includes(a[left].anchor.trackId) || ids.includes(b[right].anchor.trackId)
        || sameRef(a[left].anchor, b[right].anchor)) continue
      variants.push({ removeIds: ids, anchors: [a[left].anchor, b[right].anchor] })
    }
    return variants
  })
}

function variantForSolution(layout: LayoutData, solution: TrackHelperSolution): Variant | undefined {
  const ids = new Set(solution.removeIds)
  return variantsFor(layout, solution.ends, new Set()).find(variant => variant.removeIds.length === ids.size
    && variant.removeIds.every(id => ids.has(id)))
}

function tracksForSequence(start: Endpoint, sequence: Candidate[], prefix: string): Track[] {
  let anchor = { ...start, angle: difference(start.angle, 0) }
  return sequence.map((candidate, index) => {
    const track = attachTrack(candidate.kind, candidate.bend, anchor, `${prefix}-${index}`)
    const next = endpoints(track)[1]
    anchor = { ...next, angle: difference(next.angle, 0) }
    return track
  })
}

function traversesFinish(tracks: Track[], anchors: [TrackEndRef, TrackEndRef], addedIds: Set<string>): boolean {
  return withTrackGraph(tracks, () => {
    let current = anchors[0]
    const seen = new Set<string>()
    for (let step = 0; step <= addedIds.size; step++) {
      const next = connectedEndpoint(tracks, current.trackId, current.end)
      if (!next) return false
      const back = connectedEndpoint(tracks, next.track.id, next.end)
      if (back?.track.id !== current.trackId || back.end !== current.end) return false
      const nextRef = { trackId: next.track.id, end: next.end }
      if (sameRef(nextRef, anchors[1])) return seen.size === addedIds.size
      if (!addedIds.has(next.track.id) || seen.has(next.track.id) || next.end > 1) return false
      seen.add(next.track.id)
      current = { trackId: next.track.id, end: 1 - next.end }
    }
    return false
  })
}

function closesSelectedLoop(tracks: Track[], anchors: [TrackEndRef, TrackEndRef], added: Track[]): boolean {
  const first = added[0] ?? tracks.find(track => track.id === anchors[0].trackId)
  if (!first) return false
  return pathsFor(first).filter(route => added.length || route.startPort === anchors[0].end || route.endPort === anchors[0].end)
    .some(route => closedRouteLength(tracks, { trackId: first.id, route: route.route, distance: 0, direction: 1, laps: 0 }) !== null
      || closedRouteLength(tracks, { trackId: first.id, route: route.route, distance: 0, direction: -1, laps: 0 }) !== null)
}

function validateSolution(layout: LayoutData, solution: TrackHelperSolution, baselineErrors?: Set<string>): { allowed: boolean; message: string } {
  const reject = (message: string) => ({ allowed: false, message })
  if (!Array.isArray(solution.tracks) || !Array.isArray(solution.removeIds) || !Array.isArray(solution.ends)
    || solution.ends.length !== 2 || solution.tracks.length > TRACK_HELPER_LIMITS.pieces
    || solution.removeIds.length > TRACK_HELPER_LIMITS.repairPieces || new Set(solution.removeIds).size !== solution.removeIds.length
    || (!solution.tracks.length && !solution.removeIds.length)) return reject('This suggestion has invalid piece limits.')
  const inspection = inspectTrackFeasibility(layout, solution.ends)
  if (!inspection.eligible) return reject(inspection.message)
  const variant = variantForSolution(layout, solution)
  if (!variant) return reject('The repair must remove only a short, flat terminal section at the selected ends.')
  if (layout.trains?.some(train => train.position && solution.removeIds.includes(train.position.trackId))) {
    return reject('A train occupies a piece in this repair. Move it before applying the suggestion.')
  }
  const remaining = layout.tracks.filter(track => !solution.removeIds.includes(track.id))
  const a = endpointFor({ ...layout, tracks: remaining }, variant.anchors[0])!, b = endpointFor({ ...layout, tracks: remaining }, variant.anchors[1])!
  if (Math.abs(height(a) - height(b)) > SNAP_HEIGHT) return reject('The repaired ends are at different heights.')
  const bounds = boundsFor(a, b), minimum = minimumRadius(layout)
  const ids = new Set([...layout.tracks.map(track => track.id), ...layout.accessories.map(piece => piece.id)])
  for (const track of solution.tracks) {
    const item = ITEMS.get(track.kind)
    if (!item || !finishingItem(item)
      || typeof track.id !== 'string' || !track.id.trim() || track.id.length > 100 || ids.has(track.id) || (track.bend !== 1 && track.bend !== -1)
      || ![track.x, track.y, track.angle, track.elevation ?? 0, track.endElevation ?? track.elevation ?? 0].every(Number.isFinite)
      || Math.abs(track.x) > 50000 || Math.abs(track.y) > 50000 || Math.abs(track.angle) > 1000
      || (track.elevation ?? 0) < 0 || (track.elevation ?? 0) > 500
      || (track.endElevation ?? track.elevation ?? 0) < 0 || (track.endElevation ?? track.elevation ?? 0) > 500
      || !removable(track) || Math.abs((track.elevation ?? 0) - height(a)) > SNAP_HEIGHT
      || (item.radius !== undefined && item.radius < minimum)) return reject('This suggestion contains an invalid or unsuitable finishing piece.')
    ids.add(track.id)
    const path = pathsFor(track)[0]
    const points = [path.pointAt(0), path.pointAt(path.length)]
    if (item.shape === 'curve') {
      const start = difference(track.angle, 0), turn = track.bend * item.angle!
      // Endpoint-only sampling can miss a rotated arc's furthest extent.
      for (let quadrant = -4; quadrant <= 4; quadrant++) {
        const tangent = quadrant * Math.PI / 2 - start
        if (tangent > Math.min(0, turn) && tangent < Math.max(0, turn)) points.push(path.pointAt(Math.abs(tangent) * item.radius!))
      }
    }
    for (const point of points) {
      if (point.x < bounds.minX - 1e-8 || point.x > bounds.maxX + 1e-8 || point.y < bounds.minY - 1e-8 || point.y > bounds.maxY + 1e-8) {
        return reject('This suggestion leaves the permitted finishing area.')
      }
    }
  }
  if (remaining.length + solution.tracks.length + layout.accessories.length > getLayoutPieceLimit(layout.sourcePlan)) {
    return reject('This suggestion would exceed the layout’s piece limit.')
  }
  const proposed = [...remaining, ...solution.tracks], addedIds = new Set(solution.tracks.map(track => track.id))
  if (!traversesFinish(proposed, variant.anchors, addedIds)) return reject('The railway has changed, or this suggestion no longer connects both ends.')
  const oldErrors = baselineErrors ?? new Set(auditClearances(layout).filter(issue => issue.severity === 'error').map(issue => issue.id))
  const error = auditClearances({ ...layout, tracks: proposed }).find(issue => issue.severity === 'error'
    && (issue.pieceIds.some(id => addedIds.has(id)) || !oldErrors.has(issue.id)))
  if (error) return reject(error.message)
  return { allowed: true, message: 'This finishing section connects both ends and passes the existing clearance checks.' }
}

/** Revalidate against the CURRENT layout, never a worker's old snapshot. */
export function validateTrackHelperSolution(layout: LayoutData, solution: TrackHelperSolution): { allowed: boolean; message: string } {
  try { return validateSolution(layout, solution) } catch { return { allowed: false, message: 'This suggestion is stale or invalid. Check the current railway again.' } }
}

function spend(budget: Budget, phaseLimit: number): boolean {
  if (budget.used >= phaseLimit || budget.used >= budget.limit) return false
  budget.used++
  return true
}

function meetingKey(x: number, y: number): string { return `${Math.floor(x / SNAP_DISTANCE)}:${Math.floor(y / SNAP_DISTANCE)}` }

function solveVariant(layout: LayoutData, originalEnds: [TrackEndRef, TrackEndRef], variant: Variant, choices: Candidate[], budget: Budget,
  phaseLimit: number, baselineErrors: Set<string>): { solutions: TrackHelperSolution[]; complete: boolean } {
  const a = endpointFor(layout, variant.anchors[0])!, b = endpointFor(layout, variant.anchors[1])!
  const expectedTurn = difference(b.angle + Math.PI, a.angle)
  // Every candidate has a multiple-of-15-degree turn. An angular mismatch to
  // that lattice cannot be repaired by any sequence of these purchased pieces.
  if (Math.abs(difference(expectedTurn, Math.round(expectedTurn / ANGLE_STEP) * ANGLE_STEP)) > SNAP_ANGLE
    || Math.abs(height(a) - height(b)) > SNAP_HEIGHT) return { solutions: [], complete: true }
  const bounds = boundsFor(a, b)
  const existingIds = new Set([...layout.tracks.map(track => track.id), ...layout.accessories.map(piece => piece.id)])
  let prefix = 'helper', suffix = 0
  while (['left', 'right'].some(side => Array.from({ length: 3 }, (_, index) => `${prefix}-${side}-${index}`).some(id => existingIds.has(id)))) {
    prefix = `helper-${++suffix}`
  }
  const longest = Math.max(...choices.map(choice => choice.length))
  const initial = (endpoint: Endpoint): State => ({ x: endpoint.position.x, y: endpoint.position.y, angle: difference(endpoint.angle, 0), sequence: [] })
  const states: State[][][] = [[[initial(a)]], [[initial(b)]]]
  let complete = true
  const levels = (side: number, depth: number): State[] => {
    while (states[side].length <= depth && complete) {
      const previous = states[side][states[side].length - 1], next: State[] = []
      const target = side === 0 ? b : a
      for (const state of previous) {
        const cosine = Math.cos(state.angle), sine = Math.sin(state.angle)
        for (const choice of choices) {
          if (!spend(budget, phaseLimit)) { complete = false; break }
          const x = state.x + choice.dx * cosine - choice.dy * sine, y = state.y + choice.dx * sine + choice.dy * cosine
          const count = state.sequence.length + 1
          if (Math.hypot(x - target.position.x, y - target.position.y) > (TRACK_HELPER_LIMITS.pieces - count) * longest + SNAP_DISTANCE) continue
          // Exact rotated arc extrema occur at world cardinal tangents.
          const samples = [...choice.samples]
          if (choice.turn) for (let quadrant = -8; quadrant <= 8; quadrant++) {
            const tangent = quadrant * Math.PI / 2 - state.angle
            if (tangent > Math.min(0, choice.turn) && tangent < Math.max(0, choice.turn)) {
              const radius = ITEMS.get(choice.kind)!.radius!
              samples.push({ x: choice.bend * radius * Math.sin(tangent), y: choice.bend * radius * (1 - Math.cos(tangent)) })
            }
          }
          if (samples.some(point => {
            const px = state.x + point.x * cosine - point.y * sine, py = state.y + point.x * sine + point.y * cosine
            return px < bounds.minX - 1e-8 || px > bounds.maxX + 1e-8 || py < bounds.minY - 1e-8 || py > bounds.maxY + 1e-8
          })) continue
          next.push({ x, y, angle: difference(state.angle + choice.turn, 0), sequence: [...state.sequence, choice] })
        }
        if (!complete) break
      }
      states[side].push(next)
    }
    return states[side][depth] ?? []
  }
  const solutions: TrackHelperSolution[] = []
  // Meet in the middle: no partial sequence is longer than three pieces.
  // Each depth is built once; searching by total depth favors shorter finishes.
  for (let count = variant.removeIds.length ? 0 : 1; count <= TRACK_HELPER_LIMITS.pieces; count++) {
    const left = levels(0, Math.ceil(count / 2)), right = levels(1, Math.floor(count / 2))
    if (!complete) return { solutions, complete: false }
    const lookup = new Map<string, State[]>()
    for (const state of right) {
      const key = meetingKey(state.x, state.y), bucket = lookup.get(key) ?? []
      bucket.push(state); lookup.set(key, bucket)
    }
    for (const first of left) {
      const cellX = Math.floor(first.x / SNAP_DISTANCE), cellY = Math.floor(first.y / SNAP_DISTANCE)
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const second of lookup.get(`${cellX + dx}:${cellY + dy}`) ?? []) {
        if (!spend(budget, phaseLimit)) return { solutions, complete: false }
        if (Math.hypot(first.x - second.x, first.y - second.y) > SNAP_DISTANCE
          || Math.abs(difference(first.angle, second.angle + Math.PI)) > SNAP_ANGLE) continue
        const leftTracks = tracksForSequence(a, first.sequence, `${prefix}-left`)
        const rightTracks = tracksForSequence(b, second.sequence, `${prefix}-right`).reverse()
        const solution: TrackHelperSolution = { tracks: [...leftTracks, ...rightTracks], removeIds: [...variant.removeIds], ends: originalEnds.map(ref => ({ ...ref })) as [TrackEndRef, TrackEndRef], closesLoop: false }
        if (!validateSolution(layout, solution, baselineErrors).allowed) continue
        const proposed = [...layout.tracks.filter(track => !variant.removeIds.includes(track.id)), ...solution.tracks]
        solution.closesLoop = closesSelectedLoop(proposed, variant.anchors, solution.tracks)
        solutions.push(solution)
        if (solutions.length === 3) return { solutions, complete: false }
      }
    }
    if (solutions.length) return { solutions, complete: false }
  }
  return { solutions, complete: true }
}

/** Fixed input order, fixed work accounting, and no random choices or wall-clock
 * cutoffs: identical requests produce identical suggestions on every device. */
export function searchTrackFeasibility(request: TrackHelperRequest): TrackHelperResult {
  const inspection = inspectTrackFeasibility(request.layout, request.ends)
  if (!inspection.eligible) return { status: 'ineligible', solutions: [], inspection, explored: 0, message: inspection.message }
  const requestedLimit = request.workLimit ?? TRACK_HELPER_LIMITS.work
  const budget: Budget = { used: 0, limit: Number.isFinite(requestedLimit) ? Math.max(0, Math.min(TRACK_HELPER_LIMITS.work, Math.floor(requestedLimit))) : TRACK_HELPER_LIMITS.work }
  const variants = variantsFor(request.layout, request.ends, new Set(request.protectedTrackIds))
  const baseline = new Set(auditClearances(request.layout).filter(issue => issue.severity === 'error').map(issue => issue.id))
  const choices = candidatesFor(request.layout, height(endpointFor(request.layout, request.ends[0])!))
  let complete = true
  for (const [index, variant] of variants.entries()) {
    // Reserve a deterministic share for verified repairs instead of allowing
    // an unsuccessful direct search to consume the entire budget.
    const phaseLimit = variants.length === 1 ? budget.limit : index === 0 ? Math.floor(budget.limit * .6)
      : budget.used + Math.floor((budget.limit - budget.used) / (variants.length - index))
    const result = solveVariant(request.layout, request.ends, variant, choices, budget, phaseLimit, baseline)
    if (result.solutions.length) {
      const solution = result.solutions[0], added = solution.tracks.length, removed = solution.removeIds.length
      const message = removed ? `We found a finish: remove ${removed} highlighted ${removed === 1 ? 'piece' : 'pieces'}${added ? ` and add ${added} ${added === 1 ? 'piece' : 'pieces'}` : ''}.`
        : `We found a finish using ${added} ${added === 1 ? 'piece' : 'pieces'}!`
      return { status: 'found', solutions: result.solutions, inspection, explored: budget.used, message }
    }
    complete = complete && result.complete
  }
  const message = complete
    ? 'No finish fits the checked single-track choices and preferred track bed within six added pieces and three removed end pieces in this area. Try changing a curve near either end, or bring the ends closer.'
    : 'Search limit reached. We have not found a finish yet. Try changing a curve near either end, or bring the ends closer and check again.'
  return { status: complete ? 'no-fit' : 'limit', solutions: [], inspection, explored: budget.used, message }
}
