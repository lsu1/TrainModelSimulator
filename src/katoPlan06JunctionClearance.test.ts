import { describe, expect, it } from 'vitest'
import { auditClearances, checkPlacement } from './clearance'
import { makeKatoPlan06 } from './katoPlan06'
import type { LayoutData } from './layout'
import { attachTrack, endpoints, pathsFor } from './track'
import type { Track } from './track'
import type { TrainType } from './trains'

const preset = makeKatoPlan06()
const pieces = (...indices: number[]) => indices.map(index => ({
  ...preset.tracks.find(track => track.id === `kato06-${String(index).padStart(3, '0')}`)!,
}))
const audit = (tracks: Track[], sourcePlan: LayoutData['sourcePlan'] = 'kato-plan06-15', trainType: TrainType = 'e5') =>
  auditClearances({ tracks, accessories: [], trainType, sourcePlan })
const errors = (tracks: Track[], sourcePlan: LayoutData['sourcePlan'] = 'kato-plan06-15', trainType: TrainType = 'e5') =>
  audit(tracks, sourcePlan, trainType).filter(issue => issue.severity === 'error')

describe('source-specific nominal junction clearance', () => {
  it.each([[61, 62], [69, 130], [150, 152]])('uses the facing inward/outward cab reserve for concentric tracks %s/%s', (first, second) => {
    const tracks = pieces(first, second)
    // E5's old symmetric reserve reports margins -0.234/-0.876/-0.804 mm.
    // The facing outward and inward reserves give +0.863/+0.313/+0.385 mm.
    expect(errors(tracks)).toEqual([])
    expect(errors(tracks, 'kato-plan02-1a').some(issue => issue.code === 'track-overlap')).toBe(true)
    expect(auditClearances({ tracks, accessories: [], trainType: 'e5' }).some(issue => issue.code === 'track-overlap')).toBe(true)
    expect(errors(tracks, 'kato-plan02-1a', 'e235')).toEqual([])
  })

  it('still rejects a true directional stock overlap after a curve is moved inward', () => {
    const [inner, outer] = pieces(69, 130)
    const a = pathsFor(inner)[0], b = pathsFor(outer)[0]
    const p = a.pointAt(a.length / 2), q = b.pointAt(b.length / 2)
    const distance = Math.hypot(p.x - q.x, p.y - q.y)
    outer.x += (p.x - q.x) / distance
    outer.y += (p.y - q.y) / distance
    expect(errors([inner, outer]).some(issue => issue.code === 'track-overlap')).toBe(true)
  })

  it('reports the S60 auxiliary fouling area after arbitrary translation, rotation and IDs', () => {
    const angle = .63, cosine = Math.cos(angle), sine = Math.sin(angle)
    const tracks = pieces(31, 216, 217).map((track, index) => ({
      ...track, id: `renamed-${index}`, x: track.x * cosine - track.y * sine + 300,
      y: track.x * sine + track.y * cosine - 450, angle: track.angle + angle,
    }))
    expect(errors(tracks)).toEqual([])
    expect(audit(tracks).map(issue => issue.code)).toEqual(['junction-fouling'])
    expect(errors(tracks, 'kato-plan02-1a').some(issue => issue.code === 'track-overlap')).toBe(true)
  })

  it('retains an independent overlap when the auxiliary shared turnout is absent', () => {
    expect(errors(pieces(31, 217)).some(issue => issue.code === 'track-overlap')).toBe(true)
  })

  it('requires the strict auxiliary link after an edit and carries source identity into placement checks', () => {
    const tracks = pieces(31, 216, 217)
    const original = tracks[0]
    expect(checkPlacement({ tracks, accessories: [], sourcePlan: 'kato-plan06-15', trainType: 'e5' }, original).allowed).toBe(true)
    const moved = { ...original, x: original.x - Math.sin(original.angle) * .5, y: original.y + Math.cos(original.angle) * .5 }
    const result = checkPlacement({ tracks, accessories: [], sourcePlan: 'kato-plan06-15', trainType: 'e5' }, moved)
    expect(result.allowed).toBe(false)
    expect(result.issues.some(issue => issue.code === 'track-overlap')).toBe(true)
  })

  it('does not reclassify a height conflict even within the physical join tolerance', () => {
    const tracks = pieces(31, 216, 217)
    tracks[0] = { ...tracks[0], elevation: .15, endElevation: .15 }
    expect(errors(tracks).some(issue => issue.code === 'track-overlap')).toBe(true)
  })

  it.each([[76, 128, 195], [93, 128, 131]])('allows separate stock corridors at the new crossing approaches %s/%s/%s', (first, middle, second) => {
    const tracks = pieces(first, middle, second)
    expect(errors(tracks)).toEqual([])
    expect(errors([tracks[0], tracks[2]]).some(issue => issue.code === 'track-overlap')).toBe(true)
    expect(errors(tracks, 'kato-plan02-1a').some(issue => issue.code === 'track-overlap')).toBe(true)
  })

  it('rejects stock overlap at a strictly connected crossing rather than waiving the whole junction', () => {
    const tracks = pieces(76, 128, 195)
    // The start port still joins crossing outlet 3, but this short-radius
    // curve's cab reserve intrudes into the neighboring approach.
    tracks[2] = { ...tracks[2], kind: 'c117' }
    expect(errors(tracks).some(issue => issue.code === 'track-overlap')).toBe(true)
  })

  it('reports only the local long-cab fouling at the strictly connected #6 curve exits', () => {
    const tracks = pieces(168, 138, 188)
    expect(errors(tracks)).toEqual([])
    expect(audit(tracks).some(issue => issue.code === 'junction-fouling')).toBe(true)
    expect(audit(tracks, 'kato-plan06-15', 'e235')).toEqual([])
    expect(errors(tracks, 'kato-plan02-1a').some(issue => issue.code === 'track-overlap')).toBe(true)
  })

  it('keeps a tightly curved #6 approach invalid even when its link is exact', () => {
    const turnout: Track = { id: 'turnout', kind: 't6r', x: 0, y: 0, angle: .4, bend: 1, elevation: 0 }
    const main = attachTrack('s186', 1, endpoints(turnout)[1], 'main')
    const branch = attachTrack('c117', -1, endpoints(turnout)[2], 'tight-curve')
    expect(errors([turnout, main, branch], 'kato-plan06-15', 'e235').some(issue => issue.code === 'track-overlap')).toBe(true)
  })

  it('keeps distant independent overlaps as errors alongside a local fouling warning', () => {
    const tracks = pieces(31, 216, 217)
    const route = pathsFor(tracks[1])[0], point = route.pointAt(15)
    const unrelated: Track = {
      id: 'distant-independent', kind: 's124', bend: 1, angle: point.angle + Math.PI / 2,
      x: point.x + Math.sin(point.angle) * 62, y: point.y - Math.cos(point.angle) * 62, elevation: point.z,
    }
    const issues = audit([...tracks, unrelated])
    expect(issues.some(issue => issue.code === 'junction-fouling')).toBe(true)
    expect(issues.some(issue => issue.severity === 'error' && issue.pieceIds.includes(unrelated.id))).toBe(true)
  })
})
