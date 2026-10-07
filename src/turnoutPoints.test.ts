import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { POINT_DURATION, POINT_THROW, TurnoutPoints, staticRailRanges } from './turnoutPoints'
import { pathsFor } from './track'
import type { Track } from './track'

const rail = new THREE.MeshStandardMaterial(), mechanism = new THREE.MeshStandardMaterial()
const trackFor = (kind = 't6r', state: 'straight' | 'branch' = 'straight'): Track => ({
  id: 'test', kind, x: 270, y: -40, angle: .73, bend: kind.endsWith('l') ? -1 : 1,
  elevation: 30, switchState: state,
})
const read = (points: TurnoutPoints) => points.snapshot(p => ({ x: p.x, y: p.z, z: p.y }))
const separation = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

describe('rendered turnout point mechanisms', () => {
  it.each(['t4l', 't4r', 't6l', 't6r', 'scissors'])('opens real blades with fixed heels and stock rails for %s', kind => {
    const track = trackFor(kind)
    const points = new TurnoutPoints(track, rail, mechanism)
    const before = read(points)
    expect(before.pairs).toHaveLength(kind === 'scissors' ? 4 : 1)
    for (const pair of before.pairs) {
      expect(pair.blades).toHaveLength(2)
      expect(pair.blades[0].closed).toBe(true)
      expect(pair.blades[0].gap).toBeCloseTo(.025, 4)
      expect(pair.blades[1].closed).toBe(false)
      expect(pair.blades[1].gap).toBeCloseTo(.025 + POINT_THROW, 4)
    }
    points.setState('branch', 100)
    points.update(100 + POINT_DURATION / 2)
    const middle = read(points)
    expect(middle.fraction).toBeCloseTo(.5, 6)
    expect(middle.animating).toBe(true)
    points.update(100 + POINT_DURATION)
    const after = read(points)
    expect(after.fraction).toBe(1)
    expect(after.animating).toBe(false)
    after.pairs.forEach((pair, i) => {
      pair.blades.forEach((blade, j) => {
        const initial = before.pairs[i].blades[j]
        expect(separation(blade.tip, initial.tip)).toBeCloseTo(POINT_THROW, 4)
        expect(separation(blade.heel, initial.heel)).toBeLessThan(.00001)
        expect(separation(blade.stockTip, initial.stockTip)).toBe(0)
        expect(blade.closed).toBe(j === 1)
        expect(blade.gap).toBeCloseTo(j === 1 ? .025 : .025 + POINT_THROW, 4)
        expect(separation(middle.pairs[i].blades[j].tip, initial.tip)).toBeCloseTo(POINT_THROW / 2, 4)
      })
      expect(separation(pair.tieBar.first, before.pairs[i].tieBar.first)).toBeGreaterThan(1.6)
      expect(separation(pair.tieBar.second, before.pairs[i].tieBar.second)).toBeGreaterThan(1.6)
    })
  })

  it('preserves the rendered pose on repeated updates and rapid reversal', () => {
    const points = new TurnoutPoints(trackFor(), rail, mechanism)
    points.setState('branch', 100)
    points.update(220)
    const before = read(points)
    points.setState('branch', 220) // Selection/other layout updates do not restart it.
    expect(read(points)).toEqual(before)
    points.setState('straight', 220)
    expect(read(points).fraction).toBe(before.fraction)
    expect(read(points).pairs).toEqual(before.pairs)
    points.update(220 + POINT_DURATION / 2)
    expect(points.fraction).toBeCloseTo(before.fraction / 2, 6)
    points.update(220 + POINT_DURATION)
    expect(points.fraction).toBe(0)
    expect(points.animating).toBe(false)
  })

  it('loads a branch state settled and settles a whole-layout replacement immediately', () => {
    const points = new TurnoutPoints(trackFor('t4l', 'branch'), rail, mechanism)
    expect(points.fraction).toBe(1)
    expect(points.animating).toBe(false)
    points.setState('straight', 100)
    points.update(170)
    expect(points.fraction).toBeLessThan(1)
    points.setState('branch', 180, true)
    expect(points.fraction).toBe(1)
    expect(points.animating).toBe(false)
  })

  it.each(['t4l', 't4r', 't6l', 't6r'])('removes duplicate static switch rails, retaining both stock rails for %s', kind => {
    const track = trackFor(kind)
    const routes = pathsFor(track)
    const bend = track.bend
    expect(staticRailRanges(track, 0, -bend as 1 | -1)).toEqual([[0, routes[0].length]])
    expect(staticRailRanges(track, 1, bend)).toEqual([[0, routes[1].length]])
    expect(staticRailRanges(track, 0, bend)[0][0]).toBeGreaterThan(60)
    expect(staticRailRanges(track, 1, -bend as 1 | -1)[0][0]).toBeGreaterThan(60)
    expect(staticRailRanges(track, 0, bend)[0][1]).toBe(routes[0].length)
  })

  it('cuts all four scissors toes without cutting the continuous outer stock rails', () => {
    const track = trackFor('scissors')
    expect(staticRailRanges(track, 0, 1)).toEqual([[82, 228]])
    expect(staticRailRanges(track, 0, -1)).toEqual([[0, 310]])
    expect(staticRailRanges(track, 1, -1)).toEqual([[82, 228]])
    expect(staticRailRanges(track, 1, 1)).toEqual([[0, 310]])
    const cross = pathsFor(track)[2]
    expect(staticRailRanges(track, 2, -1)).toEqual([[82, cross.length]])
    expect(staticRailRanges(track, 2, 1)).toEqual([[0, cross.length - 82]])
  })

  it('keeps unrelated straight-track rails intact and tapers points to a fine silver tip', () => {
    const track = trackFor('s248')
    expect(staticRailRanges(track, 0, -1)).toEqual([[0, 248]])
    expect(staticRailRanges(track, 0, 1)).toEqual([[0, 248]])
    const points = new TurnoutPoints(trackFor(), rail, mechanism)
    const mesh = points.pairs[0].blades[0].mesh
    const vertices = mesh.geometry.getAttribute('position')
    const width = (a: number, b: number) => new THREE.Vector3().fromBufferAttribute(vertices, a)
      .distanceTo(new THREE.Vector3().fromBufferAttribute(vertices, b))
    expect(width(6, 7)).toBeCloseTo(.11, 5)
    expect(width(vertices.count - 6, vertices.count - 5)).toBeCloseTo(.98, 4)
    expect(mesh.geometry.getAttribute('normal').array.every(Number.isFinite)).toBe(true)
  })
})
