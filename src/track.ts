/** Track dimensions are millimeters. Coordinates use SVG's downward-positive y. */
export interface Vec {
  x: number
  y: number
}

export type TrackKind = 's248' | 's124' | 's62' | 'c249' | 'c282' | 'c315' | 'c348'

export interface Track {
  id: string
  kind: TrackKind
  x: number
  y: number
  /** The tangent pointing from the start toward the end, in radians. */
  angle: number
  /** Curves turn clockwise (1) or counterclockwise (-1). */
  bend: 1 | -1
}

export interface TrackSpec {
  kind: TrackKind
  label: string
  name: string
  length: number
  radius?: number
  angle?: number
}

const CURVE_ANGLE = Math.PI / 4

export const TRACK_CATALOG: TrackSpec[] = [
  { kind: 's248', label: 'S248', name: '248 mm straight', length: 248 },
  { kind: 's124', label: 'S124', name: '124 mm straight', length: 124 },
  { kind: 's62', label: 'S62', name: '62 mm straight', length: 62 },
  ...([249, 282, 315, 348] as const).map((radius) => ({
    kind: `c${radius}` as TrackKind,
    label: `R${radius}-45`,
    name: `${radius} mm radius · 45° curve`,
    length: radius * CURVE_ANGLE,
    radius,
    angle: CURVE_ANGLE,
  })),
]

const SPECS = new Map(TRACK_CATALOG.map((spec) => [spec.kind, spec]))
const EPSILON = 1e-8
export const SNAP_DISTANCE = 3
const SNAP_ANGLE = (5 * Math.PI) / 180

export function trackLength(track: Track | TrackKind): number {
  return SPECS.get(typeof track === 'string' ? track : track.kind)!.length
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function angleDifference(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b))
}

/** The tangent always points from this piece's start toward its end. */
export function pointAt(track: Track, distance: number): Vec & { angle: number } {
  const spec = SPECS.get(track.kind)!
  const along = clamp(distance, 0, spec.length)
  if (spec.radius === undefined) {
    return {
      x: track.x + Math.cos(track.angle) * along,
      y: track.y + Math.sin(track.angle) * along,
      angle: track.angle,
    }
  }

  const angle = track.angle + (track.bend * along) / spec.radius
  return {
    x: track.x + track.bend * spec.radius * (Math.sin(angle) - Math.sin(track.angle)),
    y: track.y - track.bend * spec.radius * (Math.cos(angle) - Math.cos(track.angle)),
    angle,
  }
}

export interface Endpoint {
  position: Vec
  /** The tangent pointing out of the piece at this endpoint. */
  angle: number
}

export function endpoints(track: Track): [Endpoint, Endpoint] {
  const end = pointAt(track, trackLength(track))
  return [
    { position: { x: track.x, y: track.y }, angle: track.angle + Math.PI },
    { position: { x: end.x, y: end.y }, angle: end.angle },
  ]
}

export function trackPath(track: Track): string {
  const spec = SPECS.get(track.kind)!
  const end = pointAt(track, spec.length)
  if (spec.radius === undefined) {
    return `M ${track.x} ${track.y} L ${end.x} ${end.y}`
  }
  return `M ${track.x} ${track.y} A ${spec.radius} ${spec.radius} 0 0 ${track.bend === 1 ? 1 : 0} ${end.x} ${end.y}`
}

/** Attach a new piece's start to an existing endpoint's outgoing tangent. */
export function attachTrack(kind: TrackKind, bend: 1 | -1, anchor: Endpoint, id: string): Track {
  return { id, kind, x: anchor.position.x, y: anchor.position.y, angle: anchor.angle, bend }
}

export function connectedEndpoint(
  tracks: Track[],
  trackId: string,
  end: 0 | 1,
): { track: Track; end: 0 | 1 } | null {
  const source = tracks.find((track) => track.id === trackId)
  if (!source) return null
  const anchor = endpoints(source)[end]
  let closest: { track: Track; end: 0 | 1 } | null = null
  let closestDistance = SNAP_DISTANCE + EPSILON
  for (const track of tracks) {
    if (track.id === source.id) continue
    const candidates = endpoints(track)
    for (const candidateEnd of [0, 1] as const) {
      const candidate = candidates[candidateEnd]
      const distance = Math.hypot(
        candidate.position.x - anchor.position.x,
        candidate.position.y - anchor.position.y,
      )
      const difference = Math.abs(angleDifference(candidate.angle, anchor.angle + Math.PI))
      if (distance <= SNAP_DISTANCE && distance < closestDistance && difference <= SNAP_ANGLE) {
        closest = { track, end: candidateEnd }
        closestDistance = distance
      }
    }
  }
  return closest
}

export function openEndpoints(tracks: Track[]): (Endpoint & { track: Track; end: 0 | 1 })[] {
  return tracks.flatMap((track) =>
    ([0, 1] as const)
      .filter((end) => connectedEndpoint(tracks, track.id, end) === null)
      .map((end) => ({ ...endpoints(track)[end], track, end })),
  )
}

/** Eight 45° curves and four straight pieces form a centered, closed oval. */
export function makeStarterLayout(kind: 'oval' | 'compact'): Track[] {
  const curve: TrackKind = kind === 'oval' ? 'c282' : 'c249'
  const straight: TrackKind = kind === 'oval' ? 's248' : 's124'
  const radius = SPECS.get(curve)!.radius!
  const straightLength = trackLength(straight)
  const result: Track[] = []
  let anchor: Endpoint = { position: { x: -straightLength, y: -radius }, angle: 0 }
  const sequence = [straight, straight, curve, curve, curve, curve, straight, straight, curve, curve, curve, curve]
  for (const pieceKind of sequence) {
    const track = attachTrack(pieceKind, 1, anchor, `starter-${result.length + 1}`)
    result.push(track)
    anchor = endpoints(track)[1]
  }
  return result
}

export interface TrainPosition {
  trackId: string
  /** Millimeters from the piece's start, regardless of train direction. */
  distance: number
  direction: 1 | -1
  laps: number
}

export interface TrainAdvance {
  position: TrainPosition
  stopped: boolean
  /** Each entry into tracks[0], in either direction, counts one lap. */
  lapsAdded: number
}

/** Circumference of the train's reachable circuit, or null for an open route. */
export function closedRouteLength(tracks: Track[], position: TrainPosition): number | null {
  let track = tracks.find((candidate) => candidate.id === position.trackId)
  if (!track) return null
  let direction = position.direction
  const initialState = `${track.id}:${direction}`
  const visited = new Set<string>()
  let length = 0
  for (let step = 0; step <= tracks.length * 2; step += 1) {
    const state = `${track.id}:${direction}`
    if (visited.has(state)) return state === initialState ? length : null
    visited.add(state)
    length += trackLength(track)
    const connection = connectedEndpoint(tracks, track.id, direction === 1 ? 1 : 0)
    if (!connection) return null
    track = connection.track
    direction = connection.end === 0 ? 1 : -1
  }
  return null
}

/** Move forward in the train's current direction, stopping at an unjoined end. */
function moveTrain(
  tracks: Track[],
  position: TrainPosition,
  millimeters: number,
  includeOpenEndpoint: boolean,
): TrainAdvance {
  let track = tracks.find((candidate) => candidate.id === position.trackId)
  if (!track) return { position: { ...position }, stopped: true, lapsAdded: 0 }
  const next = { ...position, distance: clamp(position.distance, 0, trackLength(track)) }
  let remaining = Number.isFinite(millimeters) ? Math.max(0, millimeters) : 0
  let traveled = 0
  let lapsAdded = 0
  if (remaining <= EPSILON) return { position: next, stopped: false, lapsAdded }

  // Deterministic joins form a finite route. Once a state repeats, skip full
  // cycles so a large time step cannot lead to an unbounded traversal loop.
  const seen = new Map<string, { traveled: number; lapsAdded: number }>()
  const maximumTransitions = Math.max(16, tracks.length * 4 + 4)
  for (let transition = 0; transition < maximumTransitions; transition += 1) {
    const length = trackLength(track)
    const entryDistance = next.direction === 1 ? 0 : length
    if (Math.abs(next.distance - entryDistance) <= EPSILON) {
      const key = `${track.id}:${next.direction}`
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
      } else {
        seen.set(key, { traveled, lapsAdded })
      }
    }

    const available = next.direction === 1 ? length - next.distance : next.distance
    if (remaining < available - EPSILON) {
      next.distance += next.direction * remaining
      next.laps = position.laps + lapsAdded
      return { position: next, stopped: false, lapsAdded }
    }

    remaining = Math.max(0, remaining - available)
    traveled += available
    const exitEnd: 0 | 1 = next.direction === 1 ? 1 : 0
    next.distance = exitEnd === 1 ? length : 0
    const connection = connectedEndpoint(tracks, track.id, exitEnd)
    if (!connection) {
      next.laps = position.laps + lapsAdded
      return { position: next, stopped: !(includeOpenEndpoint && remaining <= EPSILON), lapsAdded }
    }

    track = connection.track
    next.trackId = track.id
    next.direction = connection.end === 0 ? 1 : -1
    next.distance = connection.end === 0 ? 0 : trackLength(track)
    if (track.id === tracks[0]?.id) lapsAdded += 1
    if (remaining <= EPSILON) {
      next.laps = position.laps + lapsAdded
      return { position: next, stopped: false, lapsAdded }
    }
  }

  // Defensive bound for malformed input; valid finite routes complete above.
  next.laps = position.laps + lapsAdded
  return { position: next, stopped: true, lapsAdded }
}

export function advanceTrain(tracks: Track[], position: TrainPosition, millimeters: number): TrainAdvance {
  return moveTrain(tracks, position, millimeters, false)
}

/** Locate a bogie behind the front, including across joins; null off an open end. */
export function sampleBehind(
  tracks: Track[],
  position: TrainPosition,
  millimeters: number,
): (Vec & { angle: number }) | null {
  const reversed: TrainPosition = { ...position, direction: position.direction === 1 ? -1 : 1 }
  const sampled = moveTrain(tracks, reversed, millimeters, true)
  if (sampled.stopped) return null
  const track = tracks.find((candidate) => candidate.id === sampled.position.trackId)
  if (!track) return null
  const point = pointAt(track, sampled.position.distance)
  return {
    ...point,
    angle: point.angle + (sampled.position.direction === 1 ? Math.PI : 0),
  }
}
