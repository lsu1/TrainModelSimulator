import { describe, expect, it } from 'vitest'
import { KATO_CATALOG } from './catalog'
import { makeKatoPlan02 } from './katoPlan'
import { makeKatoPlan06 } from './katoPlan06'
import { pathsFor } from './track'
import type { Track } from './track'
import { TURNOUT_LABEL_LIFT, turnoutLabelPlacement } from './turnoutLabelPlacement'

const kinds = KATO_CATALOG.filter(item => item.shape === 'turnout' || item.shape === 'scissors').map(item => item.kind)
const configurations = kinds.flatMap(kind => [1, -1].flatMap(bend =>
  [0, Math.PI / 2, -Math.PI / 2, Math.PI, .73].flatMap(angle => [0, 60].map(elevation =>
    ({ kind, bend: bend as 1 | -1, angle, elevation })))))

function expectOwnRail(track: Track) {
  const { anchor, position } = turnoutLabelPlacement(track)
  // All turnout first routes are straight. Check perpendicular distance
  // independently, including mirrored and rotated catalog pieces.
  const route = pathsFor(track)[0], entry = route.pointAt(0)
  // A scissors piece's first rail is 16.5 mm from the body center.
  const lateral = -(position.x - entry.x) * Math.sin(entry.angle) + (position.y - entry.y) * Math.cos(entry.angle)
  expect(Math.abs(lateral)).toBeLessThan(1e-8)
  const along = (position.x - entry.x) * Math.cos(entry.angle) + (position.y - entry.y) * Math.sin(entry.angle)
  expect(along).toBeGreaterThan(0)
  expect(along).toBeLessThan(route.length)
  const rail = route.pointAt(along)
  expect(anchor.z).toBeCloseTo(rail.z + 7.35, 8)
  expect(position.x).toBe(anchor.x)
  expect(position.y).toBe(anchor.y)
  expect(position.z - anchor.z).toBe(TURNOUT_LABEL_LIFT)
  expect(turnoutLabelPlacement({ ...track, switchNumber: 99, switchState: 'branch' })).toEqual({ anchor, position })
}

describe('turnout number anchors', () => {
  it.each(configurations)('keeps $kind bend $bend angle $angle elevation $elevation on its own rail', config => {
    expectOwnRail({ id: 'switch', x: 270, y: -40, ...config, endElevation: config.elevation + 8, switchNumber: 1 })
  })

  it('does not reverse the labels of adjacent KATO plan06 switches 1 and 4', () => {
    const layout = makeKatoPlan06()
    const first = layout.tracks.find(track => track.switchNumber === 1)!
    const fourth = layout.tracks.find(track => track.switchNumber === 4)!
    const a = turnoutLabelPlacement(first), b = turnoutLabelPlacement(fourth)
    expect(first.id).toBe('kato06-003')
    expect(fourth.id).toBe('kato06-021')
    expect(first.y - fourth.y).toBeGreaterThan(32)
    expect(first.y - fourth.y).toBeLessThan(33)
    expect(a.position.y).toBeGreaterThan(b.position.y)
    expect(a.position.y - b.position.y).toBeGreaterThan(32)
    expectOwnRail(first)
    expectOwnRail(fourth)
  })

  it.each([['M1 + V1 + V2', makeKatoPlan02, 2], ['plan06', makeKatoPlan06, 24]] as const)(
    'anchors every numbered switch in %s without editing its layout', (_name, make, count) => {
      const layout = make(), before = JSON.stringify(layout)
      const switches = layout.tracks.filter(track => track.switchNumber !== undefined)
      expect(switches).toHaveLength(count)
      for (const track of switches) expectOwnRail(track)
      expect(JSON.stringify(layout)).toBe(before)
    },
  )
})
