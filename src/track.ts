import { KATO_CATALOG } from './catalog'
import type { CatalogItem } from './catalogTypes'

/** Millimeters: x/y are the layout plane and z is height above the table. */
export interface Vec { x: number; y: number; z?: number }
export type TrackKind = string
export type TrackSpec = CatalogItem
export interface Track {
  id: string
  kind: TrackKind
  x: number
  y: number
  /** Tangent from the piece's start toward its end, in radians. */
  angle: number
  bend: 1 | -1
  elevation?: number
  endElevation?: number
  switchState?: 'straight' | 'branch'
  /** Stable layout label shared with the central turnout controls. */
  switchNumber?: number
  route?: number
}
export interface TrackPoint extends Vec { z: number; angle: number; slope: number }
export interface TrackRoute {
  route: number
  startPort: number
  endPort: number
  length: number
  pointAt(distance: number): TrackPoint
}
export interface Endpoint {
  position: Vec
  /** Tangent pointing out of the piece at this port. */
  angle: number
  slope?: number
}
export const TRACK_CATALOG: TrackSpec[] = KATO_CATALOG.filter((item) => item.shape !== 'accessory')
const SPECS = new Map(TRACK_CATALOG.map((spec) => [spec.kind, spec]))
const EPSILON = 1e-8
export const SNAP_DISTANCE = 0.25
export const SNAP_HEIGHT = 0.25
export const SNAP_ANGLE = 0.25 * Math.PI / 180
// Train sampling and endpoint lookup share immutable geometry between frames.
const GEOMETRY_CACHE = new WeakMap<Track, { key: string; paths: TrackRoute[]; endpoints?: Endpoint[] }>()

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
function angleDifference(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b))
}
function specFor(track: Track | TrackKind): TrackSpec {
  const spec = SPECS.get(typeof track === 'string' ? track : track.kind)
  if (!spec) throw new Error(`Unknown track piece: ${typeof track === 'string' ? track : track.kind}`)
  return spec
}
type LocalPoint = { x: number; y: number; angle: number }
interface LocalRoute {
  route: number
  startPort: number
  endPort: number
  length: number
  pointAt(distance: number): LocalPoint
}
function line(route: number, startPort: number, endPort: number, length: number, x = 0, y = 0, angle = 0): LocalRoute {
  return { route, startPort, endPort, length, pointAt: (distance) => ({
    x: x + Math.cos(angle) * clamp(distance, 0, length),
    y: y + Math.sin(angle) * clamp(distance, 0, length), angle,
  }) }
}
function arc(route: number, startPort: number, endPort: number, radius: number, angle: number, bend: 1 | -1, y = 0): LocalRoute {
  const length = radius * angle
  return { route, startPort, endPort, length, pointAt: (distance) => {
    const heading = bend * clamp(distance, 0, length) / radius
    return { x: bend * radius * Math.sin(heading), y: y + bend * radius * (1 - Math.cos(heading)), angle: heading }
  } }
}
/** Smooth nominal crossovers for the scissors track; not a manufacturing template. */
function crossover(route: number, startPort: number, endPort: number, length: number, startY: number, endY: number): LocalRoute {
  const at = (t: number): LocalPoint => {
    const u = 1 - t
    const x = length * (1.05 * u * u * t + 1.95 * u * t * t + t * t * t)
    const y = startY + (endY - startY) * (3 * t * t - 2 * t * t * t)
    const dx = length * (1.05 * u * u + 1.8 * u * t + 1.05 * t * t)
    const dy = (endY - startY) * 6 * t * u
    return { x, y, angle: Math.atan2(dy, dx) }
  }
  const samples = [{ distance: 0, t: 0, point: at(0) }]
  for (let index = 1; index <= 80; index += 1) {
    const point = at(index / 80)
    const previous = samples[index - 1]
    samples.push({ distance: previous.distance + Math.hypot(point.x - previous.point.x, point.y - previous.point.y), t: index / 80, point })
  }
  const total = samples[samples.length - 1].distance
  return { route, startPort, endPort, length: total, pointAt: (distance) => {
    const along = clamp(distance, 0, total)
    const upper = samples.findIndex((sample) => sample.distance >= along)
    if (upper <= 0) return at(0)
    const previous = samples[upper - 1]
    const next = samples[upper]
    return at(previous.t + (next.t - previous.t) * (along - previous.distance) / (next.distance - previous.distance))
  } }
}
function localRoutes(track: Track): LocalRoute[] {
  const spec = specFor(track)
  const spacing = spec.laneSpacing ?? 33
  const radius = spec.radius ?? 282
  const curveAngle = spec.angle ?? Math.PI / 4
  switch (spec.shape) {
    case 'curve': return [arc(0, 0, 1, radius, curveAngle, track.bend)]
    case 'turnout': return [
      line(0, 0, 1, spec.length),
      arc(1, 0, 2, spec.branchRadius ?? radius, spec.branchAngle ?? Math.PI / 12, track.bend),
    ]
    case 'crossing': {
      const angle = (spec.crossingAngle ?? Math.PI / 2) * track.bend
      return [line(0, 0, 1, spec.length), line(1, 2, 3, spec.length,
        spec.length / 2 * (1 - Math.cos(angle)), -spec.length / 2 * Math.sin(angle), angle)]
    }
    case 'doubleStraight': return [line(0, 0, 1, spec.length, 0, -spacing / 2), line(1, 2, 3, spec.length, 0, spacing / 2)]
    case 'doubleCurve': {
      const midpoint = spec.innerRadius && spec.outerRadius ? (spec.innerRadius + spec.outerRadius) / 2 : radius
      return [arc(0, 0, 1, midpoint + track.bend * spacing / 2, curveAngle, track.bend, -spacing / 2),
        arc(1, 2, 3, midpoint - track.bend * spacing / 2, curveAngle, track.bend, spacing / 2)]
    }
    case 'scissors': return [
      line(0, 0, 1, spec.length, 0, -spacing / 2), line(1, 2, 3, spec.length, 0, spacing / 2),
      crossover(2, 0, 3, spec.length, -spacing / 2, spacing / 2),
      crossover(3, 2, 1, spec.length, spacing / 2, -spacing / 2),
    ]
    default: return [line(0, 0, 1, spec.length)]
  }
}

/** Every physical rail route, including turnout branches and independent lanes. */
export function pathsFor(track: Track): TrackRoute[] {
  const key = [track.kind, track.x, track.y, track.angle, track.bend, track.elevation ?? 0, track.endElevation ?? track.elevation ?? 0].join(':')
  const cached = GEOMETRY_CACHE.get(track)
  if (cached?.key === key) return cached.paths
  const originX = track.x
  const originY = track.y
  const heading = track.angle
  const cosine = Math.cos(track.angle)
  const sine = Math.sin(track.angle)
  const startHeight = track.elevation ?? 0
  const endHeight = track.endElevation ?? startHeight
  const rise = endHeight - startHeight
  const shape = specFor(track).shape
  const paths = localRoutes(track).map((route) => {
    // A rigid purchased straight keeps its physical length when inclined.
    // Invalid rises remain drawable, but engineering.ts marks them impossible.
    const projection = (shape === 'straight' || shape === 'doubleStraight') && Math.abs(rise) < route.length
      ? Math.sqrt(1 - (rise / route.length) ** 2) : 1
    return { ...route, pointAt: (distance: number): TrackPoint => {
    const along = clamp(distance, 0, route.length)
    const point = route.pointAt(along)
    return {
      x: originX + point.x * projection * cosine - point.y * sine,
      y: originY + point.x * projection * sine + point.y * cosine,
      z: startHeight + (endHeight - startHeight) * along / Math.max(route.length, EPSILON),
      angle: heading + point.angle,
      slope: rise / Math.max(route.length * projection, EPSILON),
    }
  } } })
  GEOMETRY_CACHE.set(track, { key, paths })
  return paths
}
function routeFor(track: Track, route = track.route ?? 0): TrackRoute {
  const routes = pathsFor(track)
  return routes.find((path) => path.route === route) ?? routes[0]
}
export function trackLength(track: Track | TrackKind, route?: number): number {
  if (typeof track === 'string') return specFor(track).length
  return routeFor(track, route).length
}
export function pointAt(track: Track, distance: number, route?: number): TrackPoint {
  return routeFor(track, route).pointAt(distance)
}
export function endpoints(track: Track): Endpoint[] {
  const paths = pathsFor(track)
  const cached = GEOMETRY_CACHE.get(track)!
  if (cached.endpoints) return cached.endpoints
  const result: Endpoint[] = []
  for (const path of paths) {
    const start = path.pointAt(0)
    const end = path.pointAt(path.length)
    result[path.startPort] ??= { position: { x: start.x, y: start.y, z: start.z }, angle: start.angle + Math.PI, slope: -start.slope }
    result[path.endPort] ??= { position: { x: end.x, y: end.y, z: end.z }, angle: end.angle, slope: end.slope }
  }
  cached.endpoints = result
  return result
}
/** Kept for SVG exports of the main route. */
export function trackPath(track: Track): string {
  const spec = specFor(track)
  const path = routeFor(track)
  const start = path.pointAt(0)
  const end = path.pointAt(path.length)
  if (spec.shape === 'curve') return `M ${start.x} ${start.y} A ${spec.radius} ${spec.radius} 0 0 ${track.bend === 1 ? 1 : 0} ${end.x} ${end.y}`
  return Array.from({ length: 33 }, (_, index) => {
    const point = path.pointAt(path.length * index / 32)
    return `${index ? 'L' : 'M'} ${point.x} ${point.y}`
  }).join(' ')
}
export function attachTrack(kind: TrackKind, bend: 1 | -1, anchor: Endpoint, id: string): Track {
  const track: Track = { id, kind, x: anchor.position.x, y: anchor.position.y, angle: anchor.angle, bend }
  if (anchor.position.z) track.elevation = anchor.position.z
  // A double-track piece's first lane starts beside its origin.
  const start = endpoints(track)[0].position
  track.x += anchor.position.x - start.x
  track.y += anchor.position.y - start.y
  return track
}
function routeEntering(track: Track, port: number): TrackRoute | undefined {
  const routes = pathsFor(track).filter((route) => route.startPort === port || route.endPort === port)
  const branching = track.switchState === 'branch'
  // Points admit trains only on their selected route, including trailing entry.
  // This keeps carriage back-sampling on the same route as the leading end.
  if (specFor(track).shape === 'turnout') return routes.find((route) => route.route === (branching ? 1 : 0))
  if (specFor(track).shape === 'scissors') return routes.find((route) => branching ? route.route >= 2 : route.route < 2)
  return routes[0]
}
export function connectedEndpoint(tracks: Track[], trackId: string, end: number): { track: Track; end: number; route?: number } | null {
  const source = tracks.find((track) => track.id === trackId)
  const anchor = source && endpoints(source)[end]
  if (!anchor) return null
  let closest: { track: Track; end: number; route?: number } | null = null
  let closestDistance = SNAP_DISTANCE + EPSILON
  for (const track of tracks) {
    if (track.id === trackId) continue
    for (const [candidateEnd, candidate] of endpoints(track).entries()) {
      const distance = Math.hypot(candidate.position.x - anchor.position.x, candidate.position.y - anchor.position.y)
      const difference = Math.abs(angleDifference(candidate.angle, anchor.angle + Math.PI))
      if (distance <= SNAP_DISTANCE && distance < closestDistance
        && Math.abs((candidate.position.z ?? 0) - (anchor.position.z ?? 0)) <= SNAP_HEIGHT && difference <= SNAP_ANGLE) {
        const route = routeEntering(track, candidateEnd)?.route ?? 0
        closest = { track, end: candidateEnd, ...(route ? { route } : {}) }
        closestDistance = distance
      }
    }
  }
  return closest
}
export function openEndpoints(tracks: Track[]): (Endpoint & { track: Track; end: number })[] {
  return tracks.flatMap((track) => endpoints(track).flatMap((endpoint, end) =>
    connectedEndpoint(tracks, track.id, end) ? [] : [{ ...endpoint, track, end }]))
}
/** Align a nearby open port, retaining height so bridges cannot join ground tracks. */
export function snapTrack(tracks: Track[], candidate: Track): Track {
  const others = tracks.filter((track) => track.id !== candidate.id)
  const anchors = openEndpoints(others)
  let selected: { port: number; anchor: Endpoint; rotation: number; score: number } | undefined
  for (const [port, endpoint] of endpoints(candidate).entries()) {
    for (const anchor of anchors) {
      const distance = Math.hypot(endpoint.position.x - anchor.position.x, endpoint.position.y - anchor.position.y)
      const rotation = angleDifference(anchor.angle + Math.PI, endpoint.angle)
      if (distance > 30 || Math.abs(rotation) > 75 * Math.PI / 180
        || Math.abs((endpoint.position.z ?? 0) - (anchor.position.z ?? 0)) > SNAP_HEIGHT) continue
      const score = distance + Math.abs(rotation) * 4
      if (!selected || score < selected.score) selected = { port, anchor, rotation, score }
    }
  }
  if (!selected) return candidate
  const rotated = { ...candidate, angle: candidate.angle + selected.rotation }
  const port = endpoints(rotated)[selected.port]
  const heightCorrection = (selected.anchor.position.z ?? 0) - (port.position.z ?? 0)
  return { ...rotated, x: rotated.x + selected.anchor.position.x - port.position.x,
    y: rotated.y + selected.anchor.position.y - port.position.y,
    ...(heightCorrection ? { elevation: (rotated.elevation ?? 0) + heightCorrection,
      endElevation: (rotated.endElevation ?? rotated.elevation ?? 0) + heightCorrection } : {}) }
}
function ovalLayout(curve: TrackKind, straight: TrackKind, straightsPerSide: number, prefix: string, elevation = 0): Track[] {
  const radius = specFor(curve).radius!
  const length = trackLength(straight)
  const result: Track[] = []
  let anchor: Endpoint = { position: { x: -length * straightsPerSide / 2, y: -radius, z: elevation }, angle: 0 }
  const curvesPerSide = Math.round(Math.PI / (specFor(curve).angle ?? Math.PI / 4))
  const side = [...Array<TrackKind>(straightsPerSide).fill(straight), ...Array<TrackKind>(curvesPerSide).fill(curve)]
  for (const kind of [...side, ...side]) {
    const track = attachTrack(kind, 1, anchor, `${prefix}-${result.length + 1}`)
    result.push(track)
    anchor = endpoints(track)[1]
  }
  return result
}
/** Eight 45-degree curves and four straights, compatible with original saves. */
export function makeStarterLayout(kind: 'oval' | 'compact'): Track[] {
  return ovalLayout(kind === 'oval' ? 'c282' : 'c249', kind === 'oval' ? 's248' : 's124', 2, 'starter')
}
export function makeCityLayout(): Track[] {
  const curve = TRACK_CATALOG.find((spec) => spec.shape === 'curve' && spec.radius === 381)?.kind ?? 'c348'
  return ovalLayout(curve, 's248', 4, 'city')
}
/** Elevated closed railway crossing a separate, open railway at table level. */
export function makeViaductLayout(): Track[] {
  const curve = TRACK_CATALOG.find((spec) => spec.category === 'viaduct' && spec.shape === 'curve'
    && spec.radius === 315 && Math.abs((spec.angle ?? 0) - Math.PI / 4) < EPSILON)?.kind ?? 'c315'
  const straight = TRACK_CATALOG.find((spec) => spec.category === 'viaduct' && spec.shape === 'straight' && spec.length === 248)?.kind ?? 's248'
  const bridge = TRACK_CATALOG.find((spec) => spec.category === 'bridge' && spec.shape === 'straight' && spec.length === 248)?.kind
  const tracks = ovalLayout(curve, straight, 4, 'viaduct', 60)
  if (bridge) for (const index of [1, 2, 9, 10]) tracks[index].kind = bridge
  let anchor: Endpoint = { position: { x: 124, y: -620, z: 0 }, angle: Math.PI / 2 }
  for (let index = 0; index < 5; index += 1) {
    const track = attachTrack('s248', 1, anchor, `ground-${index + 1}`)
    tracks.push(track)
    anchor = endpoints(track)[1]
  }
  return tracks
}

export interface TrainPosition {
  trackId: string
  /** Distance on the chosen rail route from its start, independent of direction. */
  distance: number
  direction: 1 | -1
  laps: number
  route?: number
}
export interface TrainAdvance { position: TrainPosition; stopped: boolean; lapsAdded: number }
function positionRoute(track: Track, position: TrainPosition): TrackRoute {
  return routeFor(track, position.route ?? 0)
}
function routeState(track: Track, route: TrackRoute, direction: number): string {
  return `${track.id}:${route.route}:${direction}`
}
/** Circumference of the selected circuit; different crossing lanes stay separate. */
export function closedRouteLength(tracks: Track[], position: TrainPosition): number | null {
  let track = tracks.find((candidate) => candidate.id === position.trackId)
  if (!track) return null
  let route = positionRoute(track, position)
  let direction = position.direction
  const initialState = routeState(track, route, direction)
  const visited = new Set<string>()
  let length = 0
  for (let step = 0; step <= tracks.length * 8; step += 1) {
    const state = routeState(track, route, direction)
    if (visited.has(state)) return state === initialState ? length : null
    visited.add(state)
    length += route.length
    const connection = connectedEndpoint(tracks, track.id, direction === 1 ? route.endPort : route.startPort)
    if (!connection) return null
    track = connection.track
    const nextRoute = routeEntering(track, connection.end)
    if (!nextRoute) return null
    route = nextRoute
    direction = connection.end === route.startPort ? 1 : -1
  }
  return null
}
function moveTrain(tracks: Track[], position: TrainPosition, millimeters: number, includeOpenEndpoint: boolean): TrainAdvance {
  let track = tracks.find((candidate) => candidate.id === position.trackId)
  if (!track) return { position: { ...position }, stopped: true, lapsAdded: 0 }
  let route = positionRoute(track, position)
  const next = { ...position, distance: clamp(position.distance, 0, route.length) }
  let remaining = Number.isFinite(millimeters) ? Math.max(0, millimeters) : 0
  let traveled = 0
  let lapsAdded = 0
  if (remaining <= EPSILON) return { position: next, stopped: false, lapsAdded }
  const seen = new Map<string, { traveled: number; lapsAdded: number }>()
  const maximumTransitions = Math.max(24, tracks.length * 12 + 4)
  for (let transition = 0; transition < maximumTransitions; transition += 1) {
    const length = route.length
    const entryDistance = next.direction === 1 ? 0 : length
    if (Math.abs(next.distance - entryDistance) <= EPSILON) {
      const key = routeState(track, route, next.direction)
      const previous = seen.get(key)
      if (previous) {
        const cycleLength = traveled - previous.traveled
        if (cycleLength > EPSILON) {
          const cycles = Math.floor(remaining / cycleLength)
          if (cycles > 0) {
            lapsAdded += cycles * (lapsAdded - previous.lapsAdded)
            remaining -= cycles * cycleLength
            traveled += cycles * cycleLength
            if (remaining <= EPSILON) {
              next.laps = position.laps + lapsAdded
              return { position: next, stopped: false, lapsAdded }
            }
          }
        }
      } else seen.set(key, { traveled, lapsAdded })
    }
    const available = next.direction === 1 ? length - next.distance : next.distance
    if (remaining < available - EPSILON) {
      next.distance += next.direction * remaining
      next.laps = position.laps + lapsAdded
      return { position: next, stopped: false, lapsAdded }
    }
    remaining = Math.max(0, remaining - available)
    traveled += available
    const exitEnd = next.direction === 1 ? route.endPort : route.startPort
    next.distance = next.direction === 1 ? length : 0
    const connection = connectedEndpoint(tracks, track.id, exitEnd)
    if (!connection) {
      next.laps = position.laps + lapsAdded
      return { position: next, stopped: !(includeOpenEndpoint && remaining <= EPSILON), lapsAdded }
    }
    track = connection.track
    const nextRoute = routeEntering(track, connection.end)
    if (!nextRoute) return { position: next, stopped: true, lapsAdded }
    route = nextRoute
    next.trackId = track.id
    next.direction = connection.end === route.startPort ? 1 : -1
    next.distance = next.direction === 1 ? 0 : route.length
    if (route.route) next.route = route.route
    else delete next.route
    if (track.id === tracks[0]?.id) lapsAdded += 1
    if (remaining <= EPSILON) {
      next.laps = position.laps + lapsAdded
      return { position: next, stopped: false, lapsAdded }
    }
  }
  next.laps = position.laps + lapsAdded
  return { position: next, stopped: true, lapsAdded }
}
export function advanceTrain(tracks: Track[], position: TrainPosition, millimeters: number): TrainAdvance {
  return moveTrain(tracks, position, millimeters, false)
}
/** Bogie pose behind the front, including joins, branches and gradients. */
export function sampleBehind(tracks: Track[], position: TrainPosition, millimeters: number): TrackPoint | null {
  const reversed: TrainPosition = { ...position, direction: position.direction === 1 ? -1 : 1 }
  const sampled = moveTrain(tracks, reversed, millimeters, true)
  if (sampled.stopped) return null
  const track = tracks.find((candidate) => candidate.id === sampled.position.trackId)
  if (!track) return null
  const point = pointAt(track, sampled.position.distance, sampled.position.route ?? 0)
  return { ...point, angle: point.angle + (sampled.position.direction === 1 ? Math.PI : 0),
    slope: point.slope * (sampled.position.direction === 1 ? -1 : 1) }
}
