import { KATO_CATALOG } from './catalog'
import type { CatalogItem } from './catalogTypes'
import type { LayoutData, PlacedAccessory } from './layout'
import { connectedEndpoint, endpoints, pathsFor } from './track'
import type { Track, TrackPoint, TrackRoute } from './track'
import { getTrainSpec } from './trains'
import type { TrainType } from './trains'

export interface LayoutIssue {
  id: string
  severity: 'error' | 'warning'
  message: string
  detail?: string
  pieceIds: string[]
  code: string
}

/** Planning allowances in physical N-scale millimetres, not a manufacturer certificate.
 * The current E235 mesh is 20.3 mm wide; its raised pantograph reaches 44.8 mm
 * above the track-bed datum. A 50 mm baseline also allows a 4 mm upper deck;
 * deeper bridge structures require their modeled depth in addition to stock height.
 * Curved corridors add bogie-chord/body-end overhang to the straight allowance.
 */
export const CLEARANCE_ASSUMPTIONS = {
  straightHalfWidth: 11,
  rollingStockBottom: 5,
  rollingStockTop: 45,
  minimumDeckSeparation: 50,
  carHalfLength: 66.65,
  halfBogieSpacing: 43.7,
  routeSampleSpacing: 8,
} as const

const ITEM_BY_KIND = new Map(KATO_CATALOG.map(item => [item.kind, item]))
type ClearanceLayout = Pick<LayoutData, 'tracks' | 'accessories'> & Partial<Pick<LayoutData, 'trainType'>>
/** Keep the conservative vertical allowance while following each longer cab. */
export function getClearanceAssumptions(trainType: TrainType = 'e235') {
  const train = getTrainSpec(trainType)
  return {
    ...CLEARANCE_ASSUMPTIONS,
    straightHalfWidth: Math.max(CLEARANCE_ASSUMPTIONS.straightHalfWidth, train.width / 2 + .85),
    carHalfLength: Math.max(train.length, train.cabLength) / 2,
    halfBogieSpacing: train.bogieOffset,
  }
}
type ClearanceProfile = ReturnType<typeof getClearanceAssumptions>
const EPSILON = .05
type Point2 = { x: number; y: number }
interface Bounds { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }
interface Segment { a: TrackPoint; b: TrackPoint; route: number; halfWidth: number; bounds: Bounds }
interface TrackGeometry { track: Track; item: CatalogItem; segments: Segment[]; bounds: Bounds }
interface Solid {
  x: number; y: number; halfLength: number; halfWidth: number; bottom: number; top: number
  role: 'solid' | 'post' | 'beam' | 'support' | 'roadway'
}
interface SceneryGeometry {
  id: string; name: string; x: number; y: number; angle: number
  solids: Solid[]; bounds: Bounds; accessory?: PlacedAccessory
}

const emptyBounds = (): Bounds => ({ minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity })
function mergeBounds(target: Bounds, source: Bounds): Bounds {
  target.minX = Math.min(target.minX, source.minX); target.maxX = Math.max(target.maxX, source.maxX)
  target.minY = Math.min(target.minY, source.minY); target.maxY = Math.max(target.maxY, source.maxY)
  target.minZ = Math.min(target.minZ, source.minZ); target.maxZ = Math.max(target.maxZ, source.maxZ)
  return target
}
function intersects(a: Bounds, b: Bounds): boolean {
  return a.minX < b.maxX + EPSILON && b.minX < a.maxX + EPSILON
    && a.minY < b.maxY + EPSILON && b.minY < a.maxY + EPSILON
    && a.minZ < b.maxZ + EPSILON && b.minZ < a.maxZ + EPSILON
}
const difference = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b))
/** Conservative depths of the rendered Scene3D structures, not KATO dimensions.
 * Rounding includes clearance beyond the modeled lower flange/ribs. */
function upperStructureDepth(item: CatalogItem): number {
  if (item.bed === 'viaduct') return 4
  if (item.bed !== 'bridge') return 0
  if (item.shape === 'curve') return 13
  if (/deck girder/i.test(item.name)) return 15
  return 3
}
function stockHalfWidth(route: TrackRoute, distance: number, profile: ClearanceProfile): number {
  const a = route.pointAt(Math.max(0, distance - 4)), b = route.pointAt(Math.min(route.length, distance + 4))
  const heading = Math.abs(difference(a.angle, b.angle))
  if (heading < .00001) return profile.straightHalfWidth
  const radius = Math.hypot(b.x - a.x, b.y - a.y) / (2 * Math.sin(heading / 2))
  const bogie = profile.halfBogieSpacing, nose = profile.carHalfLength
  const chord = Math.sqrt(Math.max(0, radius * radius - bogie * bogie))
  const inward = radius - chord, outward = Math.hypot(chord, nose) - radius
  return profile.straightHalfWidth + Math.max(inward, outward)
}
function trackGeometry(track: Track, profile: ClearanceProfile): TrackGeometry {
  const item = ITEM_BY_KIND.get(track.kind)!
  const bounds = emptyBounds(), segments: Segment[] = []
  for (const route of pathsFor(track)) {
    const count = Math.max(1, Math.ceil(route.length / CLEARANCE_ASSUMPTIONS.routeSampleSpacing))
    for (let index = 0; index < count; index++) {
      const a = route.pointAt(route.length * index / count), b = route.pointAt(route.length * (index + 1) / count)
      const halfWidth = stockHalfWidth(route, route.length * (index + .5) / count, profile)
      const broadWidth = Math.max(12.5, halfWidth)
      const segmentBounds: Bounds = {
        minX: Math.min(a.x, b.x) - broadWidth, maxX: Math.max(a.x, b.x) + broadWidth,
        minY: Math.min(a.y, b.y) - broadWidth, maxY: Math.max(a.y, b.y) + broadWidth,
        minZ: Math.min(a.z, b.z) - upperStructureDepth(item), maxZ: Math.max(a.z, b.z) + CLEARANCE_ASSUMPTIONS.minimumDeckSeparation,
      }
      segments.push({ a, b, route: route.route, halfWidth, bounds: segmentBounds }); mergeBounds(bounds, segmentBounds)
    }
  }
  return { track, item, segments, bounds }
}
function sceneryBounds(scenery: Omit<SceneryGeometry, 'bounds'>): Bounds {
  const bounds = emptyBounds(), cosine = Math.cos(scenery.angle), sine = Math.sin(scenery.angle)
  for (const solid of scenery.solids) {
    for (const dx of [-solid.halfLength, solid.halfLength]) for (const dy of [-solid.halfWidth, solid.halfWidth]) {
      const x = solid.x + dx, y = solid.y + dy
      mergeBounds(bounds, {
        minX: scenery.x + x * cosine - y * sine, maxX: scenery.x + x * cosine - y * sine,
        minY: scenery.y + x * sine + y * cosine, maxY: scenery.y + x * sine + y * cosine,
        minZ: solid.bottom, maxZ: solid.top,
      })
    }
  }
  return bounds
}
function accessoryGeometry(accessory: PlacedAccessory): SceneryGeometry {
  const item = ITEM_BY_KIND.get(accessory.kind)!
  const length = item.footprint?.length ?? item.length, width = item.footprint?.width ?? 35, height = item.footprint?.height ?? 50
  const solids: Solid[] = [], base = accessory.elevation
  const box = (x: number, y: number, dx: number, dy: number, bottom: number, top: number, role: Solid['role'] = 'solid') =>
    solids.push({ x, y, halfLength: dx / 2, halfWidth: dy / 2, bottom: base + bottom, top: base + top, role })
  if (accessory.kind === 'a-footbridge') {
    const deck = Math.min(37, height - 13), run = Math.min(length / 2, 36)
    box(0, 0, 21, width, deck - 1.5, height + 1)
    for (const side of [-1, 1]) {
      const y = side * (width / 2 - 8)
      // Stairs occupy only the negative-X approach, matching the rendered model.
      box(-run / 2, y, run, 15, 0, deck)
      for (const x of [-7, 7]) box(x, y, 2.5, 2.5, 0, deck - 1, 'post')
    }
  } else if (item.accessoryType === 'catenary') {
    const span = Math.max(width, (item.lanes ?? 1) > 1 ? 70 : 33), top = Math.max(height, 54)
    for (const side of [-1, 1]) {
      box(0, side * span / 2, 7, 7, 0, 3, 'post')
      box(0, side * span / 2, 2, 2, 0, top, 'post')
    }
    box(0, 0, 2, span + 2, top - 3, top - 1, 'beam')
    // Contact-wire arms intentionally meet the raised pantograph: they are not
    // solid obstacles. The structural gantry beam and both posts are checked.
  } else if (accessory.kind.startsWith('a-pier-incline-') || accessory.kind === 'a-incline-spacer') {
    const componentHeight = item.supportComponentHeight!, assemblyHeight = item.supportDeckHeight!
    if (accessory.kind === 'a-incline-spacer') {
      box(0, 0, length, width, 0, componentHeight, 'support')
      box(0, 0, length, width, componentHeight, assemblyHeight, 'support')
    } else if (accessory.kind === 'a-pier-incline-s') {
      for (let step = 0; step < 3; step++)
        box(-length / 2 + (step + .5) * length / 3, 0, length / 3, width, 0, componentHeight * (step + 1) / 3, 'support')
      box(length / 3, 0, 8, 14, componentHeight, assemblyHeight - 2, 'support')
      box(0, 0, length, width, assemblyHeight - 2, assemblyHeight, 'support')
    } else {
      box(0, 0, length, width, 0, 4, 'support')
      // Conservative cross-sections mirror the rectangular 1-to-.6 taper.
      for (let layer = 0; layer < 6; layer++) {
        const fraction = 1 - .4 * layer / 6
        box(0, 0, (length - 4) * fraction, (width - 8) * fraction,
          4 + layer * (componentHeight - 7) / 6, 4 + (layer + 1) * (componentHeight - 7) / 6, 'support')
      }
      box(0, 0, length - 2, width - 2, componentHeight - 3, componentHeight, 'support')
      box(0, 0, 14, 20, componentHeight, assemblyHeight - 2, 'support')
      box(0, 0, length, width, assemblyHeight - 2, assemblyHeight, 'support')
    }
  } else if (accessory.kind === 'a-pier-tapered') {
    box(0, 0, 30, 30, 0, 4, 'support')
    // Match the 50 mm component and 10 mm attachment displayed by Scene3D.
    // Six conservative cross-sections follow its tapered 25-to-15 mm shaft.
    for (let layer = 0; layer < 6; layer++) {
      const side = 25 - layer * 10 / 6
      box(0, 0, side, side, 4 + layer * 43 / 6, 4 + (layer + 1) * 43 / 6, 'support')
    }
    box(0, 0, 24, 24, 47, 50, 'support')
    box(0, 0, 15, 18, 50, 58, 'support')
    box(0, 0, 28, 28, 58, 60, 'support')
  } else if (item.accessoryType === 'pier') {
    box(0, 0, length, width, 0, 4, 'support')
    for (const y of width > 40 ? [-width / 3, width / 3] : [0])
      box(0, y, Math.max(8, length * .46), 9, 4, height - 4, 'support')
    box(0, 0, length + 2, width + 2, height - 5, height + .8, 'support')
  } else if (item.accessoryType === 'signal') {
    box(0, 0, 7, 7, 0, 2)
    box(0, 0, 2, 2, 0, height - 6, 'post')
    box(0, -1, 4, 4.5, height - 10, height)
    box(0, 3, 3, 3, 2, 7)
  } else if (item.accessoryType === 'crossingGate') {
    // The roadway is below the wheel treads; the gate posts stand beside it.
    box(0, 0, length, width, 0, 2.4, 'roadway')
    for (const side of [-1, 1]) box(side * 14, side * (width / 2 - 6), 8, 8, 2, 33, 'post')
  } else if (item.accessoryType === 'buffer') {
    box(0, 0, 14, 15, 0, 12)
  } else if (item.accessoryType === 'platform' || item.accessoryType === 'station') {
    box(0, 0, length, width, 0, 13.4)
    const roofWidth = Math.max(22, width - 8)
    if (!/end|open|unroofed|extension/i.test(item.name) || item.accessoryType === 'station') {
      box(0, 0, length - 7, roofWidth + 4, 34, 37)
      for (let x = -(length - 12) / 2 + 15; x <= (length - 12) / 2; x += 62)
        for (const side of [-1, 1]) box(x, side * roofWidth / 3, 1.7, 1.7, 12.5, 33.5, 'post')
    }
    if (/platform-dx/.test(accessory.kind) && !/end/.test(accessory.kind))
      for (const side of [-1, 1]) box(0, side * (width / 2 - 1.2), length - 14, .9, 13, 21.2)
    if (item.accessoryType === 'station') box(-length / 3, 0, Math.min(length / 4, 45) + 5, Math.min(width / 2, 23) + 6, 12, 40)
  } else {
    box(0, 0, length + 2, width + 2, 0, height + 2)
    box(length / 4, width / 4, 10, 10, height + 1.5, height + 6.5)
  }
  const scenery = { id: accessory.id, name: item.label, x: accessory.x, y: accessory.y, angle: accessory.angle, solids, accessory }
  return { ...scenery, bounds: sceneryBounds(scenery) }
}
function pointSegmentDistance(point: Point2, a: Point2, b: Point2): { distance: number; t: number } {
  const dx = b.x - a.x, dy = b.y - a.y, denominator = dx * dx + dy * dy
  const t = denominator ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / denominator)) : 0
  return { distance: Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy), t }
}
function closestSegments(a: Point2, b: Point2, c: Point2, d: Point2): { distance: number; t: number; u: number } {
  const ab = { x: b.x - a.x, y: b.y - a.y }, cd = { x: d.x - c.x, y: d.y - c.y }
  const determinant = ab.x * cd.y - ab.y * cd.x
  if (Math.abs(determinant) > 1e-10) {
    const dx = c.x - a.x, dy = c.y - a.y
    const t = (dx * cd.y - dy * cd.x) / determinant, u = (dx * ab.y - dy * ab.x) / determinant
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return { distance: 0, t, u }
  }
  const candidates = [
    { ...pointSegmentDistance(a, c, d), t: 0, u: pointSegmentDistance(a, c, d).t },
    { ...pointSegmentDistance(b, c, d), t: 1, u: pointSegmentDistance(b, c, d).t },
    { distance: pointSegmentDistance(c, a, b).distance, t: pointSegmentDistance(c, a, b).t, u: 0 },
    { distance: pointSegmentDistance(d, a, b).distance, t: pointSegmentDistance(d, a, b).t, u: 1 },
  ]
  return candidates.reduce((best, value) => value.distance < best.distance ? value : best)
}
function lineRectangleDistance(a: Point2, b: Point2, solid: Solid): number {
  const minX = solid.x - solid.halfLength, maxX = solid.x + solid.halfLength
  const minY = solid.y - solid.halfWidth, maxY = solid.y + solid.halfWidth
  const inside = (point: Point2) => point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY
  if (inside(a) || inside(b)) return 0
  const corners = [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }]
  return Math.min(...corners.map((corner, index) => closestSegments(a, b, corner, corners[(index + 1) % 4]).distance))
}
function verticalInterval(a: number, b: number, minimum: number, maximum: number): [number, number] | null {
  if (Math.abs(b - a) < 1e-10) return a >= minimum && a <= maximum ? [0, 1] : null
  const first = (minimum - a) / (b - a), last = (maximum - a) / (b - a)
  const low = Math.max(0, Math.min(first, last)), high = Math.min(1, Math.max(first, last))
  return low <= high ? [low, high] : null
}
function collidingSolid(segment: Segment, scenery: SceneryGeometry, contactBottom?: number): Solid | undefined {
  const cosine = Math.cos(scenery.angle), sine = Math.sin(scenery.angle)
  const local = (point: Point2): Point2 => ({
    x: (point.x - scenery.x) * cosine + (point.y - scenery.y) * sine,
    y: -(point.x - scenery.x) * sine + (point.y - scenery.y) * cosine,
  })
  for (const solid of scenery.solids) {
    const at = (t: number) => local({ x: segment.a.x + (segment.b.x - segment.a.x) * t, y: segment.a.y + (segment.b.y - segment.a.y) * t })
    const envelopes = [
      { bottom: CLEARANCE_ASSUMPTIONS.rollingStockBottom, top: CLEARANCE_ASSUMPTIONS.rollingStockTop, halfWidth: segment.halfWidth },
      ...(solid.role === 'roadway' || (solid.role === 'support' && contactBottom !== undefined && solid.bottom >= contactBottom - EPSILON)
        ? [] : [{ bottom: 0, top: 7.35, halfWidth: 12.5 }]),
    ]
    for (const envelope of envelopes) {
      const interval = verticalInterval(segment.a.z, segment.b.z,
        solid.bottom - envelope.top + EPSILON, solid.top - envelope.bottom - EPSILON)
      if (interval && lineRectangleDistance(at(interval[0]), at(interval[1]), solid) < envelope.halfWidth - EPSILON) return solid
    }
  }
  return undefined
}
function bufferAtOpenEnd(accessory: PlacedAccessory, tracks: Track[], track: Track): boolean {
  if (ITEM_BY_KIND.get(accessory.kind)?.accessoryType !== 'buffer') return false
  return endpoints(track).some(port => {
    if (Math.hypot(port.position.x - accessory.x, port.position.y - accessory.y) > 14
      || Math.abs((port.position.z ?? 0) - accessory.elevation) > 1
      || Math.abs(Math.sin(port.angle - accessory.angle)) > .02) return false
    return !tracks.some(other => other.id !== track.id && endpoints(other).some(candidate =>
      Math.hypot(candidate.position.x - port.position.x, candidate.position.y - port.position.y) < .3
      && Math.abs((candidate.position.z ?? 0) - (port.position.z ?? 0)) < .3
      && Math.abs(difference(candidate.angle, port.angle + Math.PI)) < .01))
  })
}
function issue(code: string, severity: LayoutIssue['severity'], pieceIds: string[], message: string, detail?: string): LayoutIssue {
  const ids = [...new Set(pieceIds)].sort()
  return { id: `${code}:${JSON.stringify(ids)}`, code, severity, pieceIds: ids, message, ...(detail ? { detail } : {}) }
}
function connectedPortPositions(a: TrackGeometry, b: TrackGeometry): { position: TrackPoint; aRoute?: number; bRoute?: number }[] {
  const result: { position: TrackPoint; aRoute?: number; bRoute?: number }[] = []
  for (const first of endpoints(a.track)) for (const second of endpoints(b.track)) {
    if (Math.hypot(first.position.x - second.position.x, first.position.y - second.position.y) > .3
      || Math.abs((first.position.z ?? 0) - (second.position.z ?? 0)) > .3
      || Math.abs(difference(first.angle, second.angle + Math.PI)) > .01) continue
    result.push({ position: { ...first.position, z: first.position.z ?? 0, angle: first.angle, slope: first.slope ?? 0 } })
  }
  return result
}
interface TurnoutExitPort { trackId: string; position: Point2; routes: number[] }
function connectedTurnoutExits(tracks: Track[]): [TurnoutExitPort, TurnoutExitPort][] {
  const result: [TurnoutExitPort, TurnoutExitPort][] = []
  for (const turnout of tracks) {
    if (turnout.kind !== 't6l' && turnout.kind !== 't6r') continue
    const straight = connectedEndpoint(tracks, turnout.id, 1), branch = connectedEndpoint(tracks, turnout.id, 2)
    if (!straight || !branch || straight.track.id === branch.track.id) continue
    // Both links must satisfy the train router's strict position, height and yaw
    // tolerances in both directions; a nearby unconnected track does not qualify.
    const straightBack = connectedEndpoint(tracks, straight.track.id, straight.end)
    const branchBack = connectedEndpoint(tracks, branch.track.id, branch.end)
    if (straightBack?.track.id !== turnout.id || straightBack.end !== 1
      || branchBack?.track.id !== turnout.id || branchBack.end !== 2) continue
    const port = (connection: NonNullable<typeof straight>): TurnoutExitPort => ({
      trackId: connection.track.id, position: endpoints(connection.track)[connection.end].position,
      routes: pathsFor(connection.track).filter(route => route.startPort === connection.end || route.endPort === connection.end).map(route => route.route),
    })
    result.push([port(straight), port(branch)])
  }
  return result
}
function trackPairIssue(a: TrackGeometry, b: TrackGeometry, turnoutExits: [TurnoutExitPort, TurnoutExitPort][]): LayoutIssue | undefined {
  if (!intersects(a.bounds, b.bounds)) return undefined
  const joins = connectedPortPositions(a, b)
  const sharedTurnoutExits = turnoutExits.flatMap(pair => {
    const first = pair.find(port => port.trackId === a.track.id), second = pair.find(port => port.trackId === b.track.id)
    return first && second ? [{ first, second }] : []
  })
  const designedJunction = ['turnout', 'scissors', 'crossing'].includes(a.item.shape) || ['turnout', 'scissors', 'crossing'].includes(b.item.shape)
  for (const first of a.segments) for (const second of b.segments) {
    if (!intersects(first.bounds, second.bounds)) continue
    const closest = closestSegments(first.a, first.b, second.a, second.b)
    if (closest.distance >= Math.max(12.5, first.halfWidth) + Math.max(12.5, second.halfWidth) - EPSILON) continue
    const firstHeight = first.a.z + (first.b.z - first.a.z) * closest.t
    const secondHeight = second.a.z + (second.b.z - second.a.z) * closest.u
    const height = Math.abs(firstHeight - secondHeight)
    const upper = firstHeight >= secondHeight ? a : b
    const depth = upperStructureDepth(upper.item)
    const requiredSeparation = Math.max(CLEARANCE_ASSUMPTIONS.minimumDeckSeparation, CLEARANCE_ASSUMPTIONS.rollingStockTop + depth)
    if (height >= requiredSeparation - EPSILON) continue
    const firstPoint = { x: first.a.x + (first.b.x - first.a.x) * closest.t, y: first.a.y + (first.b.y - first.a.y) * closest.t }
    const secondPoint = { x: second.a.x + (second.b.x - second.a.x) * closest.u, y: second.a.y + (second.b.y - second.a.y) * closest.u }
    // Adjacent pieces necessarily share a swept corridor at their proper joint.
    // A turnout/crossing also owns its designed junction approaches; its own
    // diverging routes must not make a legitimate adjoining straight invalid.
    if (joins.some(join => {
      const reach = designedJunction ? 50 : first.halfWidth + second.halfWidth + 10
      return Math.hypot(firstPoint.x - join.position.x, firstPoint.y - join.position.y) <= reach
        && Math.hypot(secondPoint.x - join.position.x, secondPoint.y - join.position.y) <= reach
    })) continue
    // The nominal #6 outlets are 24.47 mm apart: their modeled 25 mm bed
    // flanges meet briefly beyond the turnout. Permit that local connection
    // only while the complete stock corridors remain separate. Every other
    // track, route, height conflict and collision farther from the outlets is
    // still checked, including curves whose body overhang closes the gap.
    if (height <= EPSILON && closest.distance >= first.halfWidth + second.halfWidth - EPSILON
      && sharedTurnoutExits.some(join => join.first.routes.includes(first.route) && join.second.routes.includes(second.route)
        && Math.hypot(firstPoint.x - join.first.position.x, firstPoint.y - join.first.position.y) <= 50
        && Math.hypot(secondPoint.x - join.second.position.x, secondPoint.y - join.second.position.y) <= 50)) continue
    if (height < 8) return issue('track-overlap', 'error', [a.track.id, b.track.id],
      'These tracks overlap. Use a crossing piece or move one track.',
      'Independent track beds and train corridors intersect at the same level. Proper end-to-end joints and routes inside one turnout or crossing are allowed.')
    return issue('low-overpass', 'error', [a.track.id, b.track.id],
      `The upper track is too low: leave at least ${requiredSeparation} mm between track levels.`,
      `Only ${height.toFixed(1)} mm separates these tracks here. The stock envelope reserves 45 mm above the track-bed datum; ${upper.item.label} extends approximately ${depth} mm below its roadbed. This is a conservative planning allowance, not a manufacturer-certified dimension.`)
  }
  return undefined
}
function sceneryTrackIssue(scenery: SceneryGeometry, geometry: TrackGeometry, tracks: Track[]): LayoutIssue | undefined {
  if (scenery.id === geometry.track.id || !intersects(scenery.bounds, geometry.bounds)) return undefined
  if (scenery.accessory && bufferAtOpenEnd(scenery.accessory, tracks, geometry.track)) return undefined
  const accessory = scenery.accessory
  const support = accessory && ITEM_BY_KIND.get(accessory.kind)
  // A modeled support head intentionally contacts its own roadbed at a joint.
  // A nominal flat attachment can slightly overlap the sloping roadbed mesh;
  // that contact is not a train obstruction. Keep checking the shaft, all stock
  // volumes, and every other track. The engineering report retains the need to
  // verify real slope adapters rather than treating this contact as certified.
  const intendedContact = accessory && support?.supportDeckHeight !== undefined
    && support.supportComponentHeight !== undefined
    && endpoints(geometry.track).some(port =>
      Math.hypot(port.position.x - accessory.x, port.position.y - accessory.y) <= .5
      && Math.abs((port.position.z ?? 0) - accessory.elevation - support.supportDeckHeight!) <= .25)
  const contactBottom = intendedContact ? accessory.elevation + support.supportComponentHeight! : undefined
  for (const segment of geometry.segments) {
    if (!intersects(segment.bounds, scenery.bounds)) continue
    const solid = collidingSolid(segment, scenery, contactBottom)
    if (!solid) continue
    const code = solid.role === 'beam' ? 'catenary-beam-clearance'
      : ITEM_BY_KIND.get(scenery.accessory?.kind ?? '')?.accessoryType === 'catenary' ? 'catenary-post-clearance'
        : solid.role === 'support' ? 'pier-obstruction' : 'scenery-track-clearance'
    const message = code === 'catenary-post-clearance' ? 'A catenary post is in the train’s path. Center the gantry over the rails.'
        : code === 'catenary-beam-clearance' ? 'The catenary beam is too low above this track. Raise the gantry.'
          : code === 'pier-obstruction' ? 'This pier blocks a train’s path. Move it away from the lower track.'
            : `${scenery.name} is in the train’s path. Move it beside the rails or raise it clear.`
    return issue(code, 'error', [scenery.id, geometry.track.id], message,
      'The check follows every rail route, including curves, both lanes and turnout branches, at its actual height. It checks the track bed and includes the selected train’s width, bogie chord, and longest cab overhang on curves. Scenery dimensions are simplified planning models.')
  }
  return undefined
}

/** Finds blocked rail corridors in the complete layout. Does not certify products.
 * A broad-phase bounding-box test precedes sampled route/rotated-solid checks.
 * Routes within a manufactured double track, turnout or crossing are intentional.
 */
export function auditClearances(layout: ClearanceLayout): LayoutIssue[] {
  const profile = getClearanceAssumptions(layout.trainType), train = getTrainSpec(layout.trainType)
  const tracks = layout.tracks.map(track => trackGeometry(track, profile)), scenery = layout.accessories.map(accessoryGeometry)
  const turnoutExits = connectedTurnoutExits(layout.tracks)
  const issues: LayoutIssue[] = [], reported = new Set<string>()
  const add = (value: LayoutIssue | undefined) => {
    if (value && !reported.has(value.id)) { reported.add(value.id); issues.push(value) }
  }
  for (let first = 0; first < tracks.length; first++) for (let second = first + 1; second < tracks.length; second++)
    add(trackPairIssue(tracks[first], tracks[second], turnoutExits))
  for (const piece of scenery) for (const track of tracks)
    add(sceneryTrackIssue(piece, track, layout.tracks))
  if (layout.accessories.length) add(issue('scenery-dimensions-nominal', 'warning', layout.accessories.map(piece => piece.id),
    'Scenery clearance uses simplified models. Check actual accessory dimensions before buying.',
    `The ${train.name} allowance is ${profile.straightHalfWidth.toFixed(2)} mm to either side on straight track, plus calculated curve overhang; the conservative vertical envelope reserves 45 mm above the track-bed datum. Catenary contact arms are intentional; their posts and structural beams are checked. This is a planning check, not a measured Kato accessory template.`))
  return issues
}

/** Checks a new or edited piece against actual saved track and scenery placements.
 * Returns only errors involving this candidate, so an old unrelated problem does
 * not prevent moving another piece. The caller may compare old/new issue IDs to
 * allow incremental repairs of a previously invalid imported layout.
 */
export function checkPlacement(
  layout: ClearanceLayout,
  candidate: Track | PlacedAccessory,
  replacingId = candidate.id,
): { allowed: boolean; issues: LayoutIssue[] } {
  const accessory = ITEM_BY_KIND.get(candidate.kind)?.category === 'accessory'
  const proposed = {
    ...(layout.trainType === undefined ? {} : { trainType: layout.trainType }),
    tracks: [...layout.tracks.filter(piece => piece.id !== replacingId), ...(!accessory ? [candidate as Track] : [])],
    accessories: [...layout.accessories.filter(piece => piece.id !== replacingId), ...(accessory ? [candidate as PlacedAccessory] : [])],
  }
  const issues = auditClearances(proposed).filter(value => value.pieceIds.includes(candidate.id))
  return { allowed: !issues.some(value => value.severity === 'error'), issues }
}
