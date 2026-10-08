/** Convex vertices in world model millimetres. No face ordering is required. */
export type ConvexPoint = { x: number; y: number; z: number }

const EPSILON = 1e-7
const ORIGIN_EPSILON = 1e-12
const MAX_ITERATIONS = 64
const dot = (a: ConvexPoint, b: ConvexPoint) => a.x * b.x + a.y * b.y + a.z * b.z
const subtract = (a: ConvexPoint, b: ConvexPoint): ConvexPoint => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const cross = (a: ConvexPoint, b: ConvexPoint): ConvexPoint => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x })
const length = (a: ConvexPoint) => Math.hypot(a.x, a.y, a.z)

interface Shape {
  points: readonly ConvexPoint[]
  center: ConvexPoint
  contraction: number
  min: ConvexPoint
  max: ConvexPoint
}

function shapeOf(points: readonly ConvexPoint[]): Shape | undefined {
  if (points.length < 4) return undefined
  const center = { x: 0, y: 0, z: 0 }
  const min = { x: Infinity, y: Infinity, z: Infinity }
  const max = { x: -Infinity, y: -Infinity, z: -Infinity }
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) return undefined
    for (const key of ['x', 'y', 'z'] as const) {
      center[key] += point[key] / points.length
      min[key] = Math.min(min[key], point[key]); max[key] = Math.max(max[key], point[key])
    }
  }
  // Only solids can have a strict three-dimensional intersection. Detect a
  // degenerate point, line or sheet without constructing its complete hull.
  let first: ConvexPoint | undefined, normal: ConvexPoint | undefined
  for (let index = 1; index < points.length; index++) {
    const edge = subtract(points[index], points[0])
    if (!first) {
      if (length(edge) > EPSILON) first = edge
    } else if (!normal) {
      const candidate = cross(first, edge), size = length(candidate)
      if (size > EPSILON * length(first)) normal = { x: candidate.x / size, y: candidate.y / size, z: candidate.z / size }
    }
  }
  if (!normal || !points.some(point => Math.abs(dot(normal, subtract(point, points[0]))) > EPSILON)) return undefined
  const radius = Math.max(...points.map(point => length(subtract(point, center))))
  // Contract by at most 0.0000001 mm. This removes the ambiguous case where
  // GJK finds the origin on a simplex for two solids that only touch. It cannot
  // hide a physical 0.1 mm body overlap, even on a thin fitting or sharp nose.
  return { points, center, min, max, contraction: Math.max(0, 1 - EPSILON / radius) }
}

function support(shape: Shape, direction: ConvexPoint): ConvexPoint {
  let best = shape.points[0], score = dot(best, direction)
  for (let index = 1; index < shape.points.length; index++) {
    const point = shape.points[index], next = dot(point, direction)
    if (next > score) { best = point; score = next }
  }
  return {
    x: shape.center.x + (best.x - shape.center.x) * shape.contraction,
    y: shape.center.y + (best.y - shape.center.y) * shape.contraction,
    z: shape.center.z + (best.z - shape.center.z) * shape.contraction,
  }
}

interface ClosestSimplex { points: ConvexPoint[]; closest: ConvexPoint }

/** Project the origin onto each simplex face and retain the nearest valid
 * barycentric projection. Four vertices have only fifteen possible faces;
 * this avoids direction-dependent line/triangle/tetrahedron degeneracies.
 */
function closestSimplex(points: readonly ConvexPoint[]): ClosestSimplex {
  let result: ClosestSimplex = { points: [points[0]], closest: points[0] }
  let best = dot(points[0], points[0])
  for (let mask = 1; mask < 1 << points.length; mask++) {
    const vertices = points.filter((_, index) => mask & 1 << index)
    const anchor = vertices[0]
    let weights: number[]
    if (vertices.length === 1) {
      weights = [1]
    } else if (vertices.length === 2) {
      const edge = subtract(vertices[1], anchor), denominator = dot(edge, edge)
      if (denominator < ORIGIN_EPSILON ** 2) continue
      const along = -dot(anchor, edge) / denominator
      weights = [1 - along, along]
    } else if (vertices.length === 3) {
      const first = subtract(vertices[1], anchor), second = subtract(vertices[2], anchor)
      const aa = dot(first, first), ab = dot(first, second), bb = dot(second, second)
      const denominator = dot(cross(first, second), cross(first, second))
      if (denominator <= aa * bb * 1e-24) continue
      const ap = -dot(anchor, first), bp = -dot(anchor, second)
      const u = (ap * bb - bp * ab) / denominator, v = (bp * aa - ap * ab) / denominator
      weights = [1 - u - v, u, v]
    } else {
      const first = subtract(vertices[1], anchor), second = subtract(vertices[2], anchor), third = subtract(vertices[3], anchor)
      const denominator = dot(first, cross(second, third))
      if (Math.abs(denominator) <= length(first) * length(second) * length(third) * 1e-12) continue
      const negative = { x: -anchor.x, y: -anchor.y, z: -anchor.z }
      const u = dot(negative, cross(second, third)) / denominator
      const v = dot(first, cross(negative, third)) / denominator
      const w = dot(first, cross(second, negative)) / denominator
      weights = [1 - u - v - w, u, v, w]
    }
    if (weights.some(weight => weight < -1e-12)) continue
    const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0)
    weights = weights.map(weight => Math.max(0, weight) / total)
    const closest = { x: 0, y: 0, z: 0 }
    vertices.forEach((point, index) => {
      closest.x += point.x * weights[index]; closest.y += point.y * weights[index]; closest.z += point.z * weights[index]
    })
    const distance = dot(closest, closest)
    if (distance < best) {
      best = distance
      result = { closest, points: vertices.filter((_, index) => weights[index] > 1e-14) }
    }
  }
  return result
}

/** Strict intersection of arbitrary convex solids using support-point GJK.
 * Face/edge contact is excluded, matching the other rolling-stock tests.
 */
export function convexShapesIntersect(a: readonly ConvexPoint[], b: readonly ConvexPoint[]): boolean {
  const first = shapeOf(a), second = shapeOf(b)
  if (!first || !second) return false
  for (const key of ['x', 'y', 'z'] as const) {
    if (first.max[key] <= second.min[key] + EPSILON || second.max[key] <= first.min[key] + EPSILON) return false
  }
  const minkowskiSupport = (direction: ConvexPoint) => subtract(support(first, direction), support(second, { x: -direction.x, y: -direction.y, z: -direction.z }))
  let direction = subtract(second.center, first.center)
  if (length(direction) < ORIGIN_EPSILON) direction = { x: 1, y: 0, z: 0 }
  let simplex: ClosestSimplex = { points: [], closest: minkowskiSupport(direction) }
  simplex.points.push(simplex.closest)
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const distance = length(simplex.closest)
    if (distance <= ORIGIN_EPSILON) return true
    direction = { x: -simplex.closest.x / distance, y: -simplex.closest.y / distance, z: -simplex.closest.z / distance }
    const point = minkowskiSupport(direction)
    // This is a separating plane in model mm, so its tolerance is independent
    // of car length and of the direction vector's magnitude.
    if (dot(point, direction) <= EPSILON) return false
    if (simplex.points.some(previous => length(subtract(previous, point)) <= ORIGIN_EPSILON)) return false
    const next = closestSimplex([...simplex.points, point])
    if (next.points.length === 4 || length(next.closest) <= ORIGIN_EPSILON) return true
    simplex = next
  }
  // A pathological numerical cycle must not permit an unchecked collision.
  // Ordinary rail-body prisms converge in a few iterations.
  return true
}
