import { describe, expect, it } from 'vitest'
import { convexShapesIntersect } from './convexSafety'
import type { ConvexPoint } from './convexSafety'

function box(length: number, width: number, height: number): ConvexPoint[] {
  return [-length / 2, length / 2].flatMap(x => [-width / 2, width / 2].flatMap(y => [-height / 2, height / 2].map(z => ({ x, y, z }))))
}
function transform(points: readonly ConvexPoint[], translation: ConvexPoint = { x: 0, y: 0, z: 0 }, yaw = 0, pitch = 0): ConvexPoint[] {
  return points.map(point => {
    const x = point.x * Math.cos(pitch) - point.z * Math.sin(pitch)
    const z = point.x * Math.sin(pitch) + point.z * Math.cos(pitch)
    return { x: x * Math.cos(yaw) - point.y * Math.sin(yaw) + translation.x, y: x * Math.sin(yaw) + point.y * Math.cos(yaw) + translation.y, z: z + translation.z }
  })
}
function roundedBody(length = 130): ConvexPoint[] {
  const section = [[-9.8, 4], [-9.8, 25], [-8.3, 28], [-4, 30], [4, 30], [8.3, 28], [9.8, 25], [9.8, 4]]
  return [-length / 2, length / 2].flatMap(x => section.map(([y, z]) => ({ x, y, z })))
}
function boundsOverlap(a: readonly ConvexPoint[], b: readonly ConvexPoint[]): boolean {
  return (['x', 'y', 'z'] as const).every(key => Math.max(...a.map(point => point[key])) > Math.min(...b.map(point => point[key])) && Math.max(...b.map(point => point[key])) > Math.min(...a.map(point => point[key])))
}

function boxesOverlap(first: readonly ConvexPoint[], second: readonly ConvexPoint[], firstAxes: readonly ConvexPoint[], secondAxes: readonly ConvexPoint[]): boolean {
  const cross = (a: ConvexPoint, b: ConvexPoint) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x })
  const axes = [...firstAxes, ...secondAxes, ...firstAxes.flatMap(a => secondAxes.map(b => cross(a, b)))]
  return axes.every(axis => {
    const length = Math.hypot(axis.x, axis.y, axis.z)
    if (length < 1e-9) return true
    const project = (point: ConvexPoint) => (point.x * axis.x + point.y * axis.y + point.z * axis.z) / length
    const a = first.map(project), b = second.map(project)
    return Math.max(...a) > Math.min(...b) + 1e-7 && Math.max(...b) > Math.min(...a) + 1e-7
  })
}

describe('strict convex rolling-stock intersection', () => {
  it('distinguishes separate, contained and genuinely overlapping solids', () => {
    const body = box(130, 20, 28)
    expect(convexShapesIntersect(body, transform(body, { x: 131, y: 0, z: 0 }))).toBe(false)
    expect(convexShapesIntersect(body, box(5, 5, 5))).toBe(true)
    expect(convexShapesIntersect(body, body)).toBe(true)
    expect(convexShapesIntersect(body, transform(body, { x: 129.9, y: 0, z: 0 }))).toBe(true)
  })

  it('excludes face, edge and corner contact and rejects degenerate solids', () => {
    const body = box(130, 20, 28)
    for (const translation of [{ x: 130, y: 0, z: 0 }, { x: 130, y: 20, z: 0 }, { x: 130, y: 20, z: 28 }]) {
      expect(convexShapesIntersect(body, transform(body, translation))).toBe(false)
    }
    expect(convexShapesIntersect(body, [])).toBe(false)
    expect(convexShapesIntersect(body, transform(box(20, 20, 0), { x: 0, y: 0, z: 0 }, .5, .2))).toBe(false)
  })

  it('finds separation between yawed parallel bodies with overlapping world bounds', () => {
    const local = box(130, 20, 28), yaw = Math.PI / 4
    const first = transform(local, { x: 1200, y: -2300, z: 70 }, yaw)
    const second = transform(local, { x: 1200 - Math.sin(yaw) * 20.1, y: -2300 + Math.cos(yaw) * 20.1, z: 70 }, yaw)
    expect(boundsOverlap(first, second)).toBe(true)
    expect(convexShapesIntersect(first, second)).toBe(false)
    const touching = transform(local, { x: 1200 - Math.sin(yaw) * 20, y: -2300 + Math.cos(yaw) * 20, z: 70 }, yaw)
    expect(convexShapesIntersect(first, touching)).toBe(false)
    const overlapping = transform(local, { x: 1200 - Math.sin(yaw) * 19.9, y: -2300 + Math.cos(yaw) * 19.9, z: 70 }, yaw)
    expect(convexShapesIntersect(first, overlapping)).toBe(true)
  })

  it('uses the extruded rounded roof rather than filling its empty roof corners', () => {
    const body = roundedBody()
    const clearFitting = transform(box(10, 1, 1), { x: 0, y: 9.2, z: 29 })
    expect(boundsOverlap(body, clearFitting)).toBe(true)
    expect(convexShapesIntersect(body, clearFitting)).toBe(false)
    const overlappingFitting = transform(box(10, 1, .2), { x: 0, y: 0, z: 30 })
    expect(convexShapesIntersect(body, overlappingFitting)).toBe(true)
    expect(convexShapesIntersect(body, transform(box(10, 1, .2), { x: 0, y: 0, z: 30.1 }))).toBe(false)
  })

  it('preserves a 0.1 mm thin-fitting collision after a common yaw and pitch', () => {
    const body = roundedBody(), fitting = transform(box(10, 1, .2), { x: 0, y: 0, z: 30 })
    const clear = transform(box(10, 1, .2), { x: 0, y: 0, z: 30.1 })
    const origin = { x: -3400, y: 1700, z: 50 }
    expect(convexShapesIntersect(transform(body, origin, .73, .075), transform(fitting, origin, .73, .075))).toBe(true)
    expect(convexShapesIntersect(transform(body, origin, .73, .075), transform(clear, origin, .73, .075))).toBe(false)
  })

  it('handles different yaw and pitch at a crossing and clears a raised crossing', () => {
    const first = transform(roundedBody(), { x: 0, y: 0, z: 0 }, .1, .05)
    const crossing = transform(roundedBody(), { x: 0, y: 0, z: 0 }, 1.5, -.04)
    expect(convexShapesIntersect(first, crossing)).toBe(true)
    expect(convexShapesIntersect(first, transform(roundedBody(), { x: 0, y: 0, z: 55 }, 1.5, -.04))).toBe(false)
  })

  it('is symmetric and vertex-order independent for shallow separations and overlaps', () => {
    const first = transform(roundedBody(), { x: 50, y: 60, z: 70 }, .63, .035)
    const normal = { x: -Math.sin(.63), y: Math.cos(.63), z: 0 }
    for (const separation of [19.5, 19.6, 19.7, 30]) {
      const second = transform(roundedBody(), { x: 50 + normal.x * separation, y: 60 + normal.y * separation, z: 70 }, .63, .035)
      const expected = separation < 19.6
      expect(convexShapesIntersect(first, second)).toBe(expected)
      expect(convexShapesIntersect([...second].reverse(), [...first].reverse())).toBe(expected)
    }
  })

  it('agrees with independent fifteen-axis box SAT across mixed rotations and grades', () => {
    let seed = 152435
    const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32 }
    const basis = [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }]
    let overlaps = 0, separations = 0
    for (let iteration = 0; iteration < 600; iteration++) {
      const yawA = random() * Math.PI * 2, yawB = random() * Math.PI * 2
      const pitchA = (random() - .5) * .4, pitchB = (random() - .5) * .4
      const first = transform(box(80 + random() * 120, 5 + random() * 15, 1 + random() * 35), { x: 0, y: 0, z: 0 }, yawA, pitchA)
      const second = transform(box(80 + random() * 120, 5 + random() * 15, 1 + random() * 35), { x: (random() - .5) * 150, y: (random() - .5) * 150, z: (random() - .5) * 50 }, yawB, pitchB)
      const expected = boxesOverlap(first, second, transform(basis, undefined, yawA, pitchA), transform(basis, undefined, yawB, pitchB))
      if (expected) overlaps++; else separations++
      expect(convexShapesIntersect(first, second), `sample ${iteration}`).toBe(expected)
      expect(convexShapesIntersect(second, first), `reversed sample ${iteration}`).toBe(expected)
    }
    expect(overlaps).toBeGreaterThan(100)
    expect(separations).toBeGreaterThan(100)
  })
})
