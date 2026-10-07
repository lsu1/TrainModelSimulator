import { E235_ENGINEERING_DATA, KATO_CATALOG, KATO_SUPPORT_DATA } from './catalog'
import type { CatalogSupport } from './catalog'
import type { LayoutIssue } from './clearance'
import type { LayoutData, PlacedAccessory } from './layout'
import { SNAP_ANGLE, SNAP_DISTANCE, SNAP_HEIGHT, attachTrack, connectedEndpoint, endpoints, pathsFor, pointAt, trackLength } from './track'
import type { Endpoint, Track } from './track'
import { getTrainSpec } from './trains'

/** Application planning target; KATO publishes no E235 maximum grade here. */
export const DEFAULT_RAMP_GRADE_PERCENT = 3
const CATALOG = new Map(KATO_CATALOG.map(item => [item.kind, item]))
const NEARBY_END_DISTANCE = 30
const EPSILON = 1e-8

export interface SupportPlan {
  id: string
  x: number
  y: number
  angle: number
  distanceAlong: number
  requiredHeight: number
  status: 'catalog' | 'custom'
  kind?: string
  sourceUrl?: string
  note: string
}
export interface RampOptions {
  anchor?: Endpoint
  origin?: { x: number; y: number; angle?: number; elevation?: number }
  targetHeight: number
  maxGradePercent?: number
  trackKind?: string
  idPrefix?: string
  supportCatalog?: readonly CatalogSupport[]
  existingAccessories?: readonly PlacedAccessory[]
}
export interface RampPlan {
  tracks: Track[]
  accessories: PlacedAccessory[]
  supports: SupportPlan[]
  startHeight: number
  targetHeight: number
  /** Horizontal run of the ramp, in millimeters. */
  length: number
  /** Sum of the actual purchased track lengths, in millimeters. */
  physicalLength: number
  gradePercent: number
  pieceCount: number
  issues: LayoutIssue[]
}

function issue(code: string, pieceIds: string[], message: string, detail?: string, severity: LayoutIssue['severity'] = 'warning', suffix = ''): LayoutIssue {
  return { id: `${code}:${pieceIds.join('|')}:${suffix}`, code, pieceIds, severity, message, ...(detail ? { detail } : {}) }
}
function angleDifference(a: number, b: number): number {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))
}
function numberLabel(value: number): string { return Number(value.toFixed(2)).toString() }

export function trackGradePercent(track: Track): number {
  return Math.max(...pathsFor(track).map(path => Math.abs(path.pointAt(0).slope) * 100))
}

/** Generate a straight ascent or descent; supports retain their actual product identity. */
export function planRamp(options: RampOptions): RampPlan {
  const maxGrade = options.maxGradePercent ?? DEFAULT_RAMP_GRADE_PERCENT
  if (!Number.isFinite(maxGrade) || maxGrade <= 0 || maxGrade > 10) throw new Error('Choose a planning grade above 0% and at most 10%.')
  const anchor: Endpoint = options.anchor ?? {
    position: { x: options.origin?.x ?? 0, y: options.origin?.y ?? 0, z: options.origin?.elevation ?? 0 },
    angle: options.origin?.angle ?? 0,
  }
  const startHeight = anchor.position.z ?? 0
  const targetHeight = options.targetHeight
  if (![anchor.position.x, anchor.position.y, anchor.angle, startHeight, targetHeight].every(Number.isFinite)
    || startHeight < 0 || startHeight > 500 || targetHeight < 0 || targetHeight > 120) {
    throw new Error('Choose a target height between 0 and 120 mm and a valid starting connector.')
  }
  const kind = options.trackKind ?? 's248'
  const spec = CATALOG.get(kind)
  if (!spec || spec.shape !== 'straight' || spec.verification !== 'verified' || spec.length <= 0) {
    throw new Error('Use a catalog straight with a documented fixed length for the ramp.')
  }
  const rise = targetHeight - startHeight
  const maximumRisePerPiece = spec.length * Math.sin(Math.atan(maxGrade / 100))
  const pieceCount = Math.max(1, Math.ceil(Math.abs(rise) / maximumRisePerPiece - EPSILON))
  if (pieceCount > 300) throw new Error('This grade needs more than 300 track pieces. Choose a higher planning grade or a smaller rise.')
  const prefix = options.idPrefix ?? `ramp-${globalThis.crypto.randomUUID()}`
  const tracks: Track[] = []
  let connector = anchor
  for (let index = 0; index < pieceCount; index += 1) {
    const track = attachTrack(kind, 1, connector, `${prefix}-track-${index + 1}`)
    track.elevation = startHeight + rise * index / pieceCount
    track.endElevation = startHeight + rise * (index + 1) / pieceCount
    tracks.push(track)
    connector = endpoints(track)[1]
  }
  const physicalLength = pieceCount * spec.length
  const length = Math.sqrt(physicalLength ** 2 - rise ** 2)
  const gradePercent = Math.abs(rise) / length * 100
  const supportProducts = options.supportCatalog ?? KATO_SUPPORT_DATA
  const usable = supportProducts.filter(product => product.verified && product.trackElevation !== undefined
    && CATALOG.get(product.kind)?.accessoryType === 'pier')
  const stations = new Set<number>()
  // Joints need support review even where no catalog pier has the required height.
  for (let index = 0; index <= pieceCount; index += 1) stations.add(index * spec.length)
  // Place true catalog products where their documented datum meets the ramp.
  if (Math.abs(rise) > EPSILON) for (const product of usable) {
    const distance = (product.trackElevation! - startHeight) / rise * physicalLength
    if (distance >= -EPSILON && distance <= physicalLength + EPSILON) stations.add(Math.max(0, Math.min(physicalLength, distance)))
  }
  const supports: SupportPlan[] = []
  const accessories: PlacedAccessory[] = []
  for (const distance of [...stations].sort((a, b) => a - b)) {
    const requiredHeight = startHeight + rise * distance / physicalLength
    if (requiredHeight <= EPSILON) continue
    if (supports.some(support => Math.abs(support.distanceAlong - distance) < .01)) continue
    const index = Math.min(pieceCount - 1, Math.floor(distance / spec.length))
    const point = pointAt(tracks[index], distance - index * spec.length)
    const product = usable.find(support => Math.abs(support.trackElevation! - requiredHeight) < .01)
    const id = `${prefix}-support-${supports.length + 1}`
    if (product) {
      const existing = options.existingAccessories?.find(accessory => accessory.kind === product.kind
        && Math.hypot(accessory.x - point.x, accessory.y - point.y) <= .5
        && Math.abs(accessory.elevation) <= SNAP_HEIGHT)
      supports.push({ id: existing?.id ?? id, x: point.x, y: point.y, angle: point.angle, distanceAlong: distance, requiredHeight,
        status: 'catalog', kind: product.kind, sourceUrl: product.sourceUrl,
        note: product.notes ?? 'Support roadbed-bottom height is documented by KATO. Footprint and ramp attachment still need review.' })
      if (!existing) accessories.push({ id, kind: product.kind, x: point.x, y: point.y, angle: point.angle, elevation: 0 })
    } else supports.push({ id, x: point.x, y: point.y, angle: point.angle, distanceAlong: distance, requiredHeight,
      status: 'custom', note: `A support at ${numberLabel(requiredHeight)} mm roadbed-bottom height is needed here. No matching, confirmed KATO support datum is available; provide a measured riser or verify a suitable product.` })
  }
  const issues: LayoutIssue[] = [issue('ramp-physical-review', tracks.map(track => track.id), 'Ramp needs support and transition checks',
    `${numberLabel(gradePercent)}% is a geometric planning grade, not an E235 traction guarantee. Check vertical transitions, pier adapters, attachment points, and the complete train before building. ${E235_ENGINEERING_DATA.sourceUrl}`)]
  const customCount = supports.filter(support => support.status === 'custom').length
  if (customCount) issues.push(issue('custom-supports-required', tracks.map(track => track.id), `${customCount} support heights need a measured solution`,
    'Unmatched support heights are planning notes. They are not generated as adjustable KATO piers, and catalog piers are never floated above the table.'))
  return { tracks, accessories, supports, startHeight, targetHeight, length, physicalLength, gradePercent, pieceCount, issues }
}

interface Port { track: Track; end: number; endpoint: Endpoint; key: string }
interface Pair { a: Port; b: Port }
const portKey = (id: string, end: number) => JSON.stringify([id, end])

/** Strict fit of catalog centerlines; this is not a manufacturer manufacturing tolerance. */
export function auditConnections(tracks: Track[]): LayoutIssue[] {
  const ports = tracks.flatMap(track => endpoints(track).map((endpoint, end) => ({ track, end, endpoint, key: portKey(track.id, end) })))
  const portByKey = new Map(ports.map(port => [port.key, port]))
  const paired = new Set<string>()
  const pairs: Pair[] = []
  const connections = new Map<string, Port>()
  for (const a of ports) {
    const connection = connectedEndpoint(tracks, a.track.id, a.end)
    if (!connection) continue
    const b = portByKey.get(portKey(connection.track.id, connection.end))!
    connections.set(a.key, b)
    if (!paired.has(a.key) && !paired.has(b.key)) {
      pairs.push({ a, b }); paired.add(a.key); paired.add(b.key)
    }
  }
  const candidates: (Pair & { score: number })[] = []
  for (let index = 0; index < ports.length; index += 1) {
    const a = ports[index]
    if (paired.has(a.key)) continue
    for (const b of ports.slice(index + 1)) {
      if (paired.has(b.key) || a.track.id === b.track.id) continue
      const distance = Math.hypot(a.endpoint.position.x - b.endpoint.position.x, a.endpoint.position.y - b.endpoint.position.y)
      const height = Math.abs((a.endpoint.position.z ?? 0) - (b.endpoint.position.z ?? 0))
      const heading = angleDifference(a.endpoint.angle, b.endpoint.angle + Math.PI)
      if (distance > NEARBY_END_DISTANCE || height > NEARBY_END_DISTANCE || heading > Math.PI / 2) continue
      candidates.push({ a, b, score: distance + height * 2 + heading * 10 })
    }
  }
  for (const candidate of candidates.sort((a, b) => a.score - b.score)) {
    if (paired.has(candidate.a.key) || paired.has(candidate.b.key)) continue
    pairs.push(candidate); paired.add(candidate.a.key); paired.add(candidate.b.key)
  }
  const issues: LayoutIssue[] = []
  for (const { a, b } of pairs) {
    const pieceIds = [a.track.id, b.track.id]
    const suffix = `${a.end}-${b.end}`
    const distance = Math.hypot(a.endpoint.position.x - b.endpoint.position.x, a.endpoint.position.y - b.endpoint.position.y)
    const height = Math.abs((a.endpoint.position.z ?? 0) - (b.endpoint.position.z ?? 0))
    const angle = angleDifference(a.endpoint.angle, b.endpoint.angle + Math.PI)
    if (distance > SNAP_DISTANCE + EPSILON) issues.push(issue('track-end-gap', pieceIds, `Nearby connectors have a ${numberLabel(distance)} mm gap`,
      'Snap these endpoints together or add the correct catalog adjustment piece; the simulator does not stretch purchased track.', 'error', suffix))
    if (height > SNAP_HEIGHT + EPSILON) issues.push(issue('track-end-height', pieceIds, `Nearby connectors differ by ${numberLabel(height)} mm in height`,
      'The adjoining roadbed bottoms must meet. A track on another level is not joined to this endpoint.', 'error', suffix))
    if (angle > SNAP_ANGLE + EPSILON) issues.push(issue('track-end-angle', pieceIds, `Nearby connectors differ by ${numberLabel(angle * 180 / Math.PI)}°`,
      'Purchased track cannot absorb this heading mismatch. Align both outgoing tangents in opposite directions.', 'error', suffix))
    if (distance <= SNAP_DISTANCE + EPSILON && height <= SNAP_HEIGHT + EPSILON && angle <= SNAP_ANGLE + EPSILON) {
      const gradeChange = Math.abs((a.endpoint.slope ?? 0) + (b.endpoint.slope ?? 0)) * 100
      if (gradeChange > .5) issues.push(issue('vertical-transition', pieceIds, `The grade changes by ${numberLabel(gradeChange)}% at this joint`,
        'The geometry has an abrupt vertical transition. Check wheel contact, coupler clearance, and a gradual physical transition.', 'warning', suffix))
    }
  }
  for (const port of ports) if (!paired.has(port.key)) issues.push(issue('open-end', [port.track.id], 'A track connector is open',
    'An intentional end or unfinished branch is allowed; it does not form a complete train circuit.', 'warning', `${port.end}`))
  for (const track of tracks) {
    const spec = CATALOG.get(track.kind)
    if ((spec?.lanes ?? 1) < 2) continue
    for (const group of [[0, 2], [1, 3]]) {
      const joined = group.map(end => connections.get(portKey(track.id, end)))
      if (!!joined[0] === !!joined[1]) continue
      const peer = joined.find(Boolean)!
      const peerIsDouble = (CATALOG.get(peer.track.kind)?.lanes ?? 1) > 1
      issues.push(issue('double-lane-partial', [track.id, peer.track.id], 'Only one lane of a double-track interface is joined',
        'Check both 33 mm-spaced lane connectors. One connected lane does not prove that the complete double-track roadbed fits.', peerIsDouble ? 'error' : 'warning', group.join('-')))
    }
  }
  return issues
}

export interface EngineeringAuditOptions { maxGradePercent?: number }

/** Audit supported centerline facts while explicitly retaining unverified limits. */
export function auditEngineering(layout: Pick<LayoutData, 'tracks' | 'accessories'> & Partial<Pick<LayoutData, 'trainType'>>, options: EngineeringAuditOptions = {}): LayoutIssue[] {
  const issues = auditConnections(layout.tracks)
  const train = getTrainSpec(layout.trainType)
  const maxGrade = options.maxGradePercent ?? DEFAULT_RAMP_GRADE_PERCENT
  if (!Number.isFinite(maxGrade) || maxGrade <= 0) throw new Error('Use a positive planning grade limit.')
  for (const track of layout.tracks) {
    const spec = CATALOG.get(track.kind)!
    const maximumGrade = trackGradePercent(track)
    if (maximumGrade > maxGrade + EPSILON) issues.push(issue('grade-above-target', [track.id], `${numberLabel(maximumGrade)}% exceeds the ${numberLabel(maxGrade)}% planning target`,
      `This target is an application guideline, not a published KATO ${train.model} maximum. Traction depends on formation, rolling resistance, transitions, and track condition.`))
    const rise = Math.abs((track.endElevation ?? track.elevation ?? 0) - (track.elevation ?? 0))
    if ((spec.shape === 'straight' || spec.shape === 'doubleStraight') && rise >= spec.length) issues.push(issue('track-rise-impossible', [track.id], 'The rise is at least the purchased track length',
      'A fixed-length straight cannot provide this rise and a horizontal railway run. Use several real pieces for a supported, shallow ramp.', 'error'))
    if (rise > EPSILON && spec.shape !== 'straight' && spec.shape !== 'doubleStraight') issues.push(issue('graded-special-geometry', [track.id], 'This graded curve or special track needs a measured template',
      'The simulator interpolates height along this route. It does not prove a rigid curved, banked, turnout, or crossing product can take that three-dimensional shape.'))
    const minimumRadius = spec.shape === 'doubleCurve' ? spec.innerRadius : spec.shape === 'curve' ? spec.radius : undefined
    const actualMinimum = train.minimumRadius ?? E235_ENGINEERING_DATA.minimumRadiusMm
    if (minimumRadius !== undefined && actualMinimum !== undefined && minimumRadius < actualMinimum) {
      issues.push(issue('curve-below-minimum', [track.id], `R${numberLabel(minimumRadius)} is below the sourced ${train.model} R${actualMinimum} minimum`, train.referenceUrl, 'error'))
    } else if (train.type === 'e235' && minimumRadius !== undefined && minimumRadius < E235_ENGINEERING_DATA.recommendedRadiusMm) {
      issues.push(issue('curve-below-recommendation', [track.id], `R${numberLabel(minimumRadius)} is below the official R${E235_ENGINEERING_DATA.recommendedRadiusMm} starter choice`,
        `The official minimum radius is unconfirmed. Verify this exact train and curve before purchasing. ${E235_ENGINEERING_DATA.sourceUrl}`))
    }
    if (spec.verification === 'nominal') issues.push(issue('track-geometry-nominal', [track.id], `${spec.label} uses nominal geometry`,
      `${spec.notes ?? 'This product has not been measured as a complete engineering template.'} ${spec.sourceUrl}`))
    if (spec.shape === 'doubleCurve' && /banking/i.test(spec.notes ?? '')) issues.push(issue('banking-unverified', [track.id], 'Banking and transition geometry need product checks',
      `Catalog centerline radii are sourced, but the simulator does not reproduce bank angles or transition interfaces. ${spec.sourceUrl}`))
    if (track.kind === 'v348' && (track.elevation ?? 0) > SNAP_HEIGHT) issues.push(issue('viaduct-intermediate-support', [track.id], 'R348-45V also requires an intermediate support',
      'End piers alone do not satisfy the official extra-support requirement. Confirm the actual intermediate attachment position and compatible pier with KATO’s elevated-track reference. https://unitrack.katomodels.com/products/line_single/elevated_line'))
    const raisedEnds = endpoints(track).filter(endpoint => (endpoint.position.z ?? 0) > SNAP_HEIGHT)
    const missingSupports = raisedEnds.filter(endpoint => !layout.accessories.some(accessory => {
      const support = KATO_SUPPORT_DATA.find(product => product.kind === accessory.kind)
      return support?.verified && support.trackElevation !== undefined
        && Math.hypot(accessory.x - endpoint.position.x, accessory.y - endpoint.position.y) <= 12
        && Math.abs(accessory.elevation + support.trackElevation - (endpoint.position.z ?? 0)) <= SNAP_HEIGHT
    }))
    if (missingSupports.length) issues.push(issue('elevated-supports-unverified', [track.id], 'Raised track ends need verified supports',
      `Required roadbed support heights: ${missingSupports.map(endpoint => `${numberLabel(endpoint.position.z ?? 0)} mm at (${numberLabel(endpoint.position.x)}, ${numberLabel(endpoint.position.y)}) mm`).join('; ')}. These joints have no matching, documented support placement. Include real piers, adapters, or measured risers in the parts plan; an elevated track mesh alone is unsupported.`))
  }
  if (layout.tracks.length) {
    if (train.type === 'e235') issues.push(issue('e235-limits-unconfirmed', [], 'E235 minimum radius and maximum grade remain unconfirmed',
      `${E235_ENGINEERING_DATA.notes} ${E235_ENGINEERING_DATA.sourceUrl}`))
    else issues.push(issue('train-grade-unconfirmed', [], `${train.model} maximum grade remains unconfirmed`,
      `KATO publishes R${train.minimumRadius} as the minimum curve for this product. That does not establish grade, adjacent-track, platform, or overhang compatibility. ${train.referenceUrl}`))
  }
  for (const accessory of layout.accessories) {
    const product = KATO_SUPPORT_DATA.find(support => support.kind === accessory.kind)
    if (!product) continue
    if (!product.verified || product.trackElevation === undefined) {
      issues.push(issue('support-datum-unconfirmed', [accessory.id], 'This pier has no confirmed roadbed support height',
        `${product.notes ?? 'A visual component height alone does not prove where the track rests.'} ${product.sourceUrl}`))
      continue
    }
    const supportedHeight = accessory.elevation + product.trackElevation
    let nearest: { track: Track; distance: number; height: number } | null = null
    for (const track of layout.tracks) for (const path of pathsFor(track)) {
      const samples = Math.max(8, Math.ceil(path.length / 4))
      for (let index = 0; index <= samples; index += 1) {
        const point = path.pointAt(path.length * index / samples)
        const distance = Math.hypot(point.x - accessory.x, point.y - accessory.y)
        if (!nearest || distance < nearest.distance) nearest = { track, distance, height: point.z }
      }
    }
    if (!nearest || nearest.distance > 15) issues.push(issue('support-not-under-track', [accessory.id], 'This support is not underneath a track centerline',
      'Place and rotate the correct support at its documented attachment position; footprint checks remain approximate.'))
    else if (Math.abs(nearest.height - supportedHeight) > SNAP_HEIGHT) issues.push(issue('support-height-mismatch', [accessory.id, nearest.track.id], 'The catalog support height does not meet this track',
      `This product supports roadbed at ${numberLabel(supportedHeight)} mm from its base; the nearby roadbed is at ${numberLabel(nearest.height)} mm. ${product.sourceUrl}`, 'error'))
    if (nearest && nearest.distance <= 15 && trackGradePercent(nearest.track) > EPSILON) issues.push(issue('support-slope-attachment-unverified', [accessory.id, nearest.track.id], 'The sloping track needs a verified pier attachment',
      'The model permits intended support-head contact with the roadbed, while checking the train corridor and pier shaft. Confirm the actual tilted adapter, rail joiner, and support attachment; a nominal flat pier head does not prove a physical slope connection.'))
    if (accessory.elevation > SNAP_HEIGHT) issues.push(issue('pier-base-raised', [accessory.id], 'This catalog pier needs a separate measured base',
      'Raising its scene elevation does not turn the product into an adjustable pier. Include the real riser or base in the physical plan.'))
  }
  return issues
}
