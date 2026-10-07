import { describe, expect, it } from 'vitest'
import { auditConnections, auditEngineering, planRamp } from './engineering'
import { KATO_CATALOG, KATO_SUPPORT_DATA } from './catalog'
import { attachTrack, endpoints, makeCityLayout, openEndpoints, pointAt } from './track'
import type { Track } from './track'
import type { PlacedAccessory } from './layout'

const straight: Track = { id: 'straight', kind: 's248', x: 0, y: 0, angle: 0, bend: 1 }
const issueCodes = (issues: ReturnType<typeof auditEngineering>) => issues.map(issue => issue.code)
const pier = (x: number, elevation = 0): PlacedAccessory => ({ id: `pier-${x}`, kind: 'a-pier-tapered', x, y: 0, angle: 0, elevation })

describe('guided ramp planning', () => {
  it('reuses an already placed matching pier for a descending ramp without duplicating its shopping quantity', () => {
    const options = { origin: { x: 0, y: 0, elevation: 60 }, targetHeight: 0, idPrefix: 'descending' }
    const first = planRamp(options)
    expect(first.accessories).toHaveLength(1)
    const reused = planRamp({ ...options, existingAccessories: first.accessories })
    expect(reused.pieceCount).toBe(9)
    expect(reused.accessories).toHaveLength(0)
    expect(reused.supports.find(support => support.status === 'catalog')?.id).toBe(first.accessories[0].id)
    expect(first.accessories).toHaveLength(1)
    const wrongBase = first.accessories.map(accessory => ({ ...accessory, elevation: 10 }))
    expect(planRamp({ ...options, existingAccessories: wrongBase }).accessories).toHaveLength(1)
  })

  it('uses enough real S248 pieces for an 80 mm rise at a 3% planning target', () => {
    const plan = planRamp({ targetHeight: 80, idPrefix: 'test' })
    expect(plan.pieceCount).toBe(11)
    expect(plan.physicalLength).toBe(2728)
    expect(plan.length).toBeCloseTo(Math.sqrt(2728 ** 2 - 80 ** 2))
    expect(plan.gradePercent).toBeCloseTo(80 / plan.length * 100)
    expect(plan.gradePercent).toBeLessThanOrEqual(3)
    expect(plan.tracks.every(track => track.kind === 's248')).toBe(true)
    expect(plan.tracks[0].elevation).toBe(0)
    expect(plan.tracks.at(-1)!.endElevation).toBe(80)
    expect(openEndpoints(plan.tracks)).toHaveLength(2)
    expect(auditConnections(plan.tracks).filter(issue => issue.severity === 'error')).toHaveLength(0)
  })

  it('attaches an evenly descending ramp to a selected rotated elevated connector', () => {
    const anchor = { position: { x: 30, y: 90, z: 60 }, angle: Math.PI / 2 }
    const plan = planRamp({ anchor, targetHeight: 0, idPrefix: 'down' })
    expect(plan.pieceCount).toBe(9)
    expect(endpoints(plan.tracks[0])[0].position).toEqual(anchor.position)
    expect(plan.tracks[0].angle).toBe(anchor.angle)
    for (let index = 0; index < plan.tracks.length - 1; index += 1) {
      expect(plan.tracks[index].endElevation).toBe(plan.tracks[index + 1].elevation)
      expect(plan.tracks[index].elevation).toBeGreaterThan(plan.tracks[index].endElevation!)
    }
    expect(pointAt(plan.tracks.at(-1)!, 248).z).toBe(0)
  })

  it('places a genuine 23-069 assembly only at its documented 60 mm roadbed datum', () => {
    const plan = planRamp({ targetHeight: 80, idPrefix: 'supports' })
    expect(plan.accessories.length).toBeGreaterThan(0)
    expect(plan.accessories.every(accessory => accessory.kind === 'a-pier-tapered' && accessory.elevation === 0)).toBe(true)
    const catalogSupports = plan.supports.filter(support => support.status === 'catalog')
    expect(catalogSupports.every(support => support.requiredHeight === 60 && support.sourceUrl?.includes('katomodels.com'))).toBe(true)
    expect(catalogSupports[0].distanceAlong).toBeCloseTo(plan.physicalLength * 60 / 80)
    expect(catalogSupports[0].x).toBeCloseTo(plan.length * 60 / 80)
    expect(plan.supports.filter(support => support.status === 'custom').length).toBeGreaterThan(0)
    expect(issueCodes(plan.issues)).toContain('custom-supports-required')
  })

  it('never promotes a component-only height or an unverified footprint to a matching support', () => {
    const componentOnly = KATO_SUPPORT_DATA.filter(support => support.trackElevation === undefined)
    const plan = planRamp({ targetHeight: 50, idPrefix: 'unknown', supportCatalog: componentOnly })
    expect(plan.accessories).toHaveLength(0)
    expect(plan.supports.every(support => support.status === 'custom')).toBe(true)
    expect(plan.supports.at(-1)!.requiredHeight).toBe(50)
  })

  it('respects a lower chosen grade and rejects impossible or invalid inputs', () => {
    const plan = planRamp({ targetHeight: 120, maxGradePercent: 2, idPrefix: 'gentle' })
    expect(plan.pieceCount).toBe(25)
    expect(plan.gradePercent).toBeLessThanOrEqual(2)
    expect(() => planRamp({ targetHeight: 121 })).toThrow(/0 and 120/)
    expect(() => planRamp({ targetHeight: Number.NaN })).toThrow()
    expect(() => planRamp({ targetHeight: 80, maxGradePercent: 0 })).toThrow()
    expect(() => planRamp({ targetHeight: 80, maxGradePercent: .01 })).toThrow(/300/)
    expect(() => planRamp({ targetHeight: 60, trackKind: 'c315' })).toThrow(/straight/)
    expect(() => planRamp({ targetHeight: 60, trackKind: 's93' })).toThrow(/documented fixed length/)
  })

  it('uses physical length when counting pieces at the exact maximum allowed grade', () => {
    const maximumRise = 10 * 248 * Math.sin(Math.atan(.03))
    const exact = planRamp({ targetHeight: maximumRise, maxGradePercent: 3, idPrefix: 'exact' })
    expect(exact.pieceCount).toBe(10)
    expect(exact.gradePercent).toBeCloseTo(3, 10)
    const stretched = planRamp({ targetHeight: 10 * 248 * .03, maxGradePercent: 3, idPrefix: 'actual' })
    expect(stretched.pieceCount).toBe(11)
    expect(stretched.gradePercent).toBeLessThan(3)
    for (const track of exact.tracks) {
      const start = pointAt(track, 0)
      const end = pointAt(track, 248)
      expect(Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z)).toBeCloseTo(248, 10)
    }
  })
})

describe('physical endpoint checks', () => {
  it('accepts exact closed catalog centerlines without an open connector or fit error', () => {
    const issues = auditConnections(makeCityLayout())
    expect(issues).toHaveLength(0)
  })

  it.each([
    ['gap', { x: 252 }, 'track-end-gap'],
    ['angle', { angle: Math.PI / 180 }, 'track-end-angle'],
    ['height', { elevation: 4 }, 'track-end-height'],
  ] as const)('identifies a nearby connector %s that a purchased track cannot absorb', (_label, patch, code) => {
    const next = { ...attachTrack('s248', 1, endpoints(straight)[1], 'next'), ...patch }
    const issues = auditConnections([straight, next])
    expect(issues.some(issue => issue.code === code && issue.severity === 'error')).toBe(true)
    expect(issues.find(issue => issue.code === code)!.pieceIds).toEqual([straight.id, next.id])
  })

  it('distinguishes a deliberately separate high-level railway from a nearby mismatched join', () => {
    const upper = { ...straight, id: 'upper', x: 248, elevation: 60, endElevation: 60 }
    expect(issueCodes(auditConnections([straight, upper]))).not.toContain('track-end-height')
    expect(issueCodes(auditConnections([straight, upper]))).toContain('open-end')
  })

  it('finds the one-lane-only connection between shifted double-track pieces', () => {
    const first = { ...straight, kind: 'ds248' }
    const second = { ...first, id: 'second', x: 248, y: -33 }
    const issues = auditConnections([first, second])
    expect(issues.some(issue => issue.code === 'double-lane-partial' && issue.severity === 'error')).toBe(true)
    const aligned = attachTrack('ds248', 1, endpoints(first)[1], 'aligned')
    expect(issueCodes(auditConnections([first, aligned]))).not.toContain('double-lane-partial')
  })

  it('flags abrupt vertical transitions even where endpoints meet exactly', () => {
    const ramp = { ...straight, elevation: 0, endElevation: 5 }
    const level = attachTrack('s248', 1, endpoints(ramp)[1], 'level')
    const issues = auditConnections([ramp, level])
    expect(issueCodes(issues)).toContain('vertical-transition')
    expect(issues.filter(issue => issue.severity === 'error')).toHaveLength(0)
  })
})

describe('engineering evidence and support audit', () => {
  it('reports nominal turnout and crossing geometry instead of certifying its idealized endpoints', () => {
    const kinds = ['t4l', 'scissors', 'x15l']
    for (const kind of kinds) {
      expect(KATO_CATALOG.find(item => item.kind === kind)!.verification).toBe('nominal')
      const issues = auditEngineering({ tracks: [{ ...straight, kind }], accessories: [] })
      expect(issueCodes(issues)).toContain('track-geometry-nominal')
    }
  })

  it('calls R315 a sourced starter recommendation and does not invent an E235 minimum', () => {
    const issues = auditEngineering({ tracks: [{ ...straight, kind: 'c249' }], accessories: [] })
    expect(issueCodes(issues)).toContain('curve-below-recommendation')
    expect(issueCodes(issues)).not.toContain('curve-below-minimum')
    expect(issueCodes(issues)).toContain('e235-limits-unconfirmed')
  })

  it.each([
    ['e5', 'c282', 'c315'],
    ['e6', 'c249', 'c282'],
    ['e7', 'c282', 'c315'],
  ] as const)('checks the sourced %s curve limit without inheriting E235 warnings', (trainType, tooTight, supported) => {
    const audit = (kind: string) => auditEngineering({ trainType, tracks: [{ ...straight, kind }], accessories: [] })
    const tight = audit(tooTight)
    expect(tight.find(issue => issue.code === 'curve-below-minimum')?.severity).toBe('error')
    expect(tight.find(issue => issue.code === 'curve-below-minimum')?.message).toContain(trainType.toUpperCase())
    expect(issueCodes(audit(supported))).not.toContain('curve-below-minimum')
    expect(issueCodes(audit(supported))).not.toContain('curve-below-recommendation')
    expect(issueCodes(audit(supported))).not.toContain('e235-limits-unconfirmed')
    expect(issueCodes(audit(supported))).toContain('train-grade-unconfirmed')
  })

  it('checks the inner double-curve radius and grade against the stated planning target', () => {
    const tracks = [{ ...straight, kind: 'dc315' }, { ...straight, id: 'steep', y: 100, endElevation: 20 }]
    const issues = auditEngineering({ tracks, accessories: [] })
    expect(issues.some(issue => issue.code === 'curve-below-recommendation' && issue.pieceIds.includes(straight.id))).toBe(true)
    expect(issues.some(issue => issue.code === 'grade-above-target' && issue.pieceIds.includes('steep'))).toBe(true)
    expect(issueCodes(issues)).toContain('banking-unverified')
  })

  it('requires explicit support products at raised joints and verifies their datum', () => {
    const raised = { ...straight, elevation: 60, endElevation: 60 }
    const missing = auditEngineering({ tracks: [raised], accessories: [] })
    expect(issueCodes(missing)).toContain('elevated-supports-unverified')
    const supported = auditEngineering({ tracks: [raised], accessories: [pier(0), pier(248)] })
    expect(issueCodes(supported)).not.toContain('elevated-supports-unverified')
    expect(issueCodes(supported)).not.toContain('support-height-mismatch')
    const wrong = auditEngineering({ tracks: [{ ...raised, elevation: 80, endElevation: 80 }], accessories: [pier(0)] })
    expect(issueCodes(wrong)).toContain('support-height-mismatch')
  })

  it('retains attachment verification for a ramp whose end meets a documented support height', () => {
    const plan = planRamp({ targetHeight: 60, idPrefix: 'adapter-review' })
    const issues = auditEngineering(plan)
    expect(issueCodes(issues)).toContain('support-slope-attachment-unverified')
    expect(issueCodes(issues)).not.toContain('support-height-mismatch')
    expect(issues.find(issue => issue.code === 'elevated-supports-unverified')?.detail).toContain('6.67 mm')
  })

  it('flags the official intermediate-support requirement of the R348-45 viaduct', () => {
    const track = { ...straight, kind: 'v348', elevation: 60, endElevation: 60 }
    expect(issueCodes(auditEngineering({ tracks: [track], accessories: [] }))).toContain('viaduct-intermediate-support')
    expect(issueCodes(auditEngineering({ tracks: [{ ...track, kind: 'v348-30' }], accessories: [] }))).not.toContain('viaduct-intermediate-support')
  })

  it('keeps ordinary pier datums and raised bases explicitly unconfirmed', () => {
    const raised = { ...straight, elevation: 80, endElevation: 80 }
    const floating = pier(0, 20)
    const component = { ...pier(248), kind: 'a-pier' }
    const issues = auditEngineering({ tracks: [raised], accessories: [floating, component] })
    expect(issueCodes(issues)).toContain('pier-base-raised')
    expect(issueCodes(issues)).toContain('support-datum-unconfirmed')
    expect(issueCodes(issues)).not.toContain('support-height-mismatch')
  })
})
