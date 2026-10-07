import { describe, expect, it } from 'vitest'
import { auditClearances, checkPlacement, CLEARANCE_ASSUMPTIONS } from './clearance'
import { createLayout } from './layout'
import { planRamp } from './engineering'
import type { PlacedAccessory } from './layout'
import { attachTrack, endpoints, pathsFor } from './track'
import type { Track } from './track'

const straight: Track = { id: 'rail', kind: 's248', x: 0, y: 0, angle: 0, bend: 1, elevation: 0 }
const scenery = (kind: string, x = 124, y = 0, elevation = 0, angle = 0): PlacedAccessory =>
  ({ id: 'scenery', kind, x, y, elevation, angle })
const errors = (tracks: Track[], accessories: PlacedAccessory[] = []) =>
  auditClearances({ tracks, accessories }).filter(issue => issue.severity === 'error')

describe('actual scenery clearance', () => {
  it('blocks a platform in the train path but accepts a platform beside straight track', () => {
    expect(checkPlacement({ tracks: [straight], accessories: [] }, scenery('a-platform')).allowed).toBe(false)
    expect(errors([straight], [scenery('a-platform', 124, 31)])).toEqual([])
    expect(errors([straight], [scenery('a-station', 124, 0)])).toHaveLength(1)
    expect(errors([straight], [scenery('a-platform', 124, 27)])).toHaveLength(1)
  })

  it('checks scenery orientation rather than only its axis-aligned bounds', () => {
    const angledRail = { ...straight, angle: Math.PI / 4 }
    const center = 124 / Math.sqrt(2), offset = 31 / Math.sqrt(2)
    expect(errors([angledRail], [scenery('a-platform', center - offset, center + offset, 0, Math.PI / 4)])).toEqual([])
    expect(errors([angledRail], [scenery('a-platform', center - offset, center + offset, 0, -Math.PI / 4)])).toHaveLength(1)
  })

  it('follows curved routes instead of blocking the empty space inside their bounding boxes', () => {
    const curve: Track = { ...straight, kind: 'c315' }
    expect(errors([curve], [scenery('a-platform-shop', 90, 30)])).toHaveLength(1)
    expect(errors([curve], [scenery('a-platform-shop', 70, 75)])).toEqual([])
  })

  it('includes E235 body overhang on curves instead of using only the rail gauge', () => {
    const curve = { ...straight, kind: 'c315' }
    const point = pathsFor(curve)[0].pointAt(100)
    expect(errors([straight], [scenery('a-signal', 124, 16.5)])).toEqual([])
    const signal = scenery('a-signal', point.x - Math.sin(point.angle) * 16.5, point.y + Math.cos(point.angle) * 16.5, 0, point.angle)
    expect(errors([curve], [signal])).toHaveLength(1)
  })

  it('allows over-track catenary when its posts stand outside the train corridor', () => {
    expect(errors([straight], [scenery('a-catenary')])).toEqual([])
    expect(errors([straight], [scenery('a-catenary', 124, 17)])[0]?.code).toBe('catenary-post-clearance')
    expect(errors([straight], [scenery('a-catenary', 124, 0, 0, Math.PI / 2)])[0]?.code).toBe('catenary-post-clearance')
  })

  it('checks double catenary posts around both lanes and catches too-low beams', () => {
    const double = { ...straight, kind: 'ds248' }
    expect(errors([double], [scenery('a-catenary-double')])).toEqual([])
    expect(errors([double], [scenery('a-catenary')])).toHaveLength(1)
    const raised = { ...straight, elevation: 20, endElevation: 20 }
    expect(errors([raised], [scenery('a-catenary')])[0]?.code).toBe('catenary-beam-clearance')
    expect(errors([raised], [scenery('a-catenary', 124, 0, 20)])).toEqual([])
  })

  it('allows a pier under its viaduct while blocking a pier in a lower train route', () => {
    const viaduct = { ...straight, kind: 'v248', elevation: 80, endElevation: 80 }
    expect(errors([viaduct], [scenery('a-pier')])).toEqual([])
    const lower = { ...straight, id: 'lower', x: 124, y: -124, angle: Math.PI / 2 }
    expect(errors([viaduct, lower], [scenery('a-pier')]).some(issue => issue.code === 'pier-obstruction')).toBe(true)
  })

  it('checks the actual tapered support shaft and its 60 mm assembled deck datum', () => {
    const viaduct = { ...straight, kind: 'v248', elevation: 60, endElevation: 60 }
    expect(errors([viaduct], [scenery('a-pier-tapered')])).toEqual([])
    expect(errors([straight], [scenery('a-pier-tapered', 124, 20)])[0]?.code).toBe('pier-obstruction')
    expect(errors([straight], [scenery('a-pier-tapered', 124, 28)])).toEqual([])
  })

  it('allows intended ramp-end adapter contact while still blocking the support shaft on a lower line', () => {
    const plan = planRamp({ targetHeight: 60, idPrefix: 'supported-ramp' })
    expect(errors(plan.tracks, plan.accessories)).toEqual([])
    const support = plan.accessories[0]
    const lower = { ...straight, id: 'lower', x: support.x, y: support.y - 124, angle: Math.PI / 2 }
    expect(errors([...plan.tracks, lower], plan.accessories).some(issue => issue.code === 'pier-obstruction' && issue.pieceIds.includes('lower'))).toBe(true)
  })

  it('does not exempt an attachment at the wrong roadbed height or in the middle of a slope', () => {
    const track = { ...straight, elevation: 59, endElevation: 59 }
    expect(errors([track], [scenery('a-pier-tapered', 248)])[0]?.code).toBe('pier-obstruction')
    const ramp = { ...straight, elevation: 50, endElevation: 60 }
    expect(errors([ramp], [scenery('a-pier-tapered', 124)])[0]?.code).toBe('pier-obstruction')
  })

  it('checks track grades at the collision location, including high scenery at the upper end', () => {
    const ramp = { ...straight, elevation: 0, endElevation: 80 }
    expect(errors([ramp], [scenery('a-platform-shop', 220, 0, 0)])).toEqual([])
    expect(errors([ramp], [scenery('a-platform-shop', 220, 0, 70)])).toHaveLength(1)
    expect(errors([ramp], [scenery('a-platform-shop', 25, 0, 0)])).toHaveLength(1)
  })

  it('uses asymmetric footbridge stairs and permits a sufficiently raised overhead walkway', () => {
    expect(errors([straight], [scenery('a-footbridge')])).toHaveLength(1)
    expect(errors([straight], [scenery('a-footbridge', 124, 0, 15)])).toEqual([])
    const stairRail = { ...straight, x: 80, y: 47, kind: 's62' }
    expect(errors([stairRail], [scenery('a-footbridge')])).toHaveLength(1)
    const opposite = { ...stairRail, x: 150 }
    expect(errors([opposite], [scenery('a-footbridge')])).toEqual([])
  })

  it('permits an end buffer but rejects one in the middle of a track or between joined pieces', () => {
    expect(errors([straight], [scenery('a-buffer', 248)])).toEqual([])
    expect(errors([straight], [scenery('a-buffer', 124)])).toHaveLength(1)
    const adjoining = attachTrack('s124', 1, endpoints(straight)[1], 'adjoining')
    expect(errors([straight, adjoining], [scenery('a-buffer', 248)])).toHaveLength(2)
  })

  it('allows moving scenery away from its old location without colliding with its replacement', () => {
    const old = scenery('a-platform')
    const result = checkPlacement({ tracks: [straight], accessories: [old] }, { ...old, y: 31 }, old.id)
    expect(result.allowed).toBe(true)
    expect(result.issues.every(issue => issue.severity === 'warning')).toBe(true)
  })
})

describe('track and support clearance', () => {
  it('rejects separate intersecting tracks and accepts a manufactured crossing piece', () => {
    const crossing = { ...straight, id: 'cross', x: 124, y: -124, angle: Math.PI / 2 }
    expect(errors([straight, crossing])[0]?.code).toBe('track-overlap')
    expect(errors([{ ...straight, kind: 'x90' }])).toEqual([])
    expect(errors([{ ...straight, kind: 'scissors' }])).toEqual([])
  })

  it('accepts proper end joints, including curve joins and all double-track lanes', () => {
    const curve = attachTrack('c315', 1, endpoints(straight)[1], 'curve')
    const last = attachTrack('c315', 1, endpoints(curve)[1], 'last')
    expect(errors([straight, curve, last])).toEqual([])
    const double = { ...straight, kind: 'ds248' }
    const doubleNext = attachTrack('dc414', 1, endpoints(double)[1], 'double-next')
    expect(errors([double, doubleNext])).toEqual([])
  })

  it('permits native 33 mm parallel track but detects overlapping beds', () => {
    expect(errors([straight, { ...straight, id: 'other', y: 33 }])).toEqual([])
    expect(errors([straight, { ...straight, id: 'other', y: 20 }])[0]?.code).toBe('track-overlap')
    expect(errors([{ ...straight, kind: 'dc315' }])).toEqual([])
  })

  it('blocks low overpasses and permits the documented pantograph/deck clearance', () => {
    const crossing = { ...straight, id: 'cross', x: 124, y: -124, angle: Math.PI / 2, elevation: 40, endElevation: 40 }
    expect(errors([straight, crossing])[0]?.code).toBe('low-overpass')
    const height = CLEARANCE_ASSUMPTIONS.minimumDeckSeparation
    expect(errors([straight, { ...crossing, elevation: height, endElevation: height }])).toEqual([])
  })

  it('requires 60 mm separation beneath a straight deck girder, including its lower flange', () => {
    const bridge = { ...straight, id: 'bridge', kind: 'b124-green', x: 124, y: -62, angle: Math.PI / 2, elevation: 50, endElevation: 50 }
    const issue = errors([straight, bridge])[0]
    expect(issue?.code).toBe('low-overpass')
    expect(issue.message).toContain('60 mm')
    expect(issue.detail).toContain('15 mm below')
    expect(errors([bridge, straight])[0]?.code).toBe('low-overpass')
    expect(errors([straight, { ...bridge, elevation: 60, endElevation: 60 }])).toEqual([])
  })

  it('requires 58 mm beneath curved bridge ribs and girders instead of the ordinary 50 mm baseline', () => {
    const bridge = { ...straight, id: 'bridge', kind: 'b448-green', elevation: 50, endElevation: 50 }
    const point = pathsFor(bridge)[0].pointAt(50)
    const lower = { ...straight, kind: 's124', x: point.x + Math.sin(point.angle) * 62, y: point.y - Math.cos(point.angle) * 62, angle: point.angle + Math.PI / 2 }
    const issue = errors([lower, bridge])[0]
    expect(issue?.code).toBe('low-overpass')
    expect(issue.message).toContain('58 mm')
    expect(errors([lower, { ...bridge, elevation: 58, endElevation: 58 }])).toEqual([])
  })

  it('only checks explicit supports, letting a high viaduct span an unobstructed lower railway', () => {
    const bridge = { ...straight, kind: 'v248', elevation: 80, endElevation: 80 }
    const lower = { ...straight, id: 'lower', x: 10, y: -124, angle: Math.PI / 2 }
    expect(errors([bridge, lower])).toEqual([])
    expect(errors([bridge, lower], [scenery('a-pier', 10)])[0]?.code).toBe('pier-obstruction')
    expect(errors([bridge, { ...lower, x: 75 }])).toEqual([])
  })

  it('checks every double-track lane and unused turnout branch for scenery obstructions', () => {
    expect(errors([{ ...straight, kind: 'ds248' }], [scenery('a-platform-shop', 124, 16.5)])).toHaveLength(1)
    const turnout = { ...straight, kind: 't6r', switchState: 'straight' as const }
    const branch = pathsFor(turnout)[1].pointAt(150)
    expect(errors([turnout], [scenery('a-platform-shop', branch.x, branch.y)])).toHaveLength(1)
    const continuation = attachTrack('s248', 1, endpoints(turnout)[1], 'continuation')
    expect(errors([turnout, continuation])).toEqual([])
  })

  it('returns actionable stable issues for repeated audits and ignores unrelated old errors on placement', () => {
    const overlapping = { ...straight, id: 'other' }
    const layout = { tracks: [straight, overlapping], accessories: [] }
    expect(auditClearances(layout)).toEqual(auditClearances(layout))
    const valid = { ...straight, id: 'distant', x: 1000 }
    expect(checkPlacement(layout, valid).allowed).toBe(true)
    const issue = errors(layout.tracks)[0]
    expect(issue.pieceIds).toEqual(['other', 'rail'])
    expect(issue.detail).toContain('end-to-end')
  })

  it('keeps the city and compact starter scenery clear', () => {
    expect(auditClearances(createLayout('city')).filter(issue => issue.severity === 'error')).toEqual([])
    expect(auditClearances(createLayout('compact')).filter(issue => issue.severity === 'error')).toEqual([])
    expect(auditClearances(createLayout('viaduct')).filter(issue => issue.severity === 'error')).toEqual([])
  })
})
