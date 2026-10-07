import * as THREE from 'three'
import { KATO_CATALOG } from './catalog'
import { pathsFor } from './track'
import type { Track, TrackPoint, TrackRoute } from './track'

// Procedural visual dimensions in model mm. KATO's nominal route geometry is
// unchanged: these are plausible point mechanisms, not measured blade templates.
export const POINT_THROW = 1.75
export const POINT_DURATION = 360
const RAIL_CENTER = 4.99
const HEAD_HALF = .49
const TIP_HALF = .055
const CLOSED_GAP = .025
const TOE = 12
const SEGMENTS = 28
const PROFILE = [
  [-.7, 5.3], [.7, 5.3], [.7, 5.75], [.22, 5.75], [.22, 6.9], [.49, 6.9],
  [.49, 7.35], [-.49, 7.35], [-.49, 6.9], [-.22, 6.9], [-.22, 5.75], [-.7, 5.75],
]

type State = 'straight' | 'branch'
type Side = 1 | -1
interface PairSpec {
  id: string
  straight: TrackRoute
  branch: TrackRoute
  start: boolean
  bend: Side
  heel: number
}
interface Blade {
  route: TrackRoute
  side: Side
  selected: State
  mesh: THREE.Mesh<THREE.BufferGeometry>
  stockTip: THREE.Vector3
  inward: THREE.Vector3
  closedDelta: THREE.Vector3
  pair: PairSpec
}
interface RenderPair { spec: PairSpec; blades: Blade[]; tieBar: THREE.Mesh; pins: THREE.Mesh[] }

function specsFor(track: Track): PairSpec[] {
  const item = KATO_CATALOG.find(item => item.kind === track.kind)
  const routes = pathsFor(track)
  if (item?.shape === 'turnout') return [{
    id: 'toe', straight: routes[0], branch: routes[1], start: true,
    bend: track.bend, heel: Math.min(90, routes[1].length * .6),
  }]
  if (item?.shape === 'scissors') return [
    { id: 'left-1', straight: routes[0], branch: routes[2], start: true, bend: 1, heel: 82 },
    { id: 'left-2', straight: routes[1], branch: routes[3], start: true, bend: -1, heel: 82 },
    { id: 'right-1', straight: routes[0], branch: routes[3], start: false, bend: -1, heel: 82 },
    { id: 'right-2', straight: routes[1], branch: routes[2], start: false, bend: 1, heel: 82 },
  ]
  return []
}

/** Static switch rails resume at the heel; the blade region belongs to moving meshes. */
export function staticRailRanges(track: Track, route: number, side: Side): [number, number][] {
  const path = pathsFor(track).find(path => path.route === route)!
  let ranges: [number, number][] = [[0, path.length]]
  for (const pair of specsFor(track)) {
    const direction = pair.start ? 1 : -1
    const movingSide = route === pair.straight.route ? pair.bend * direction
      : route === pair.branch.route ? -pair.bend * direction : 0
    if (side !== movingSide) continue
    const cut: [number, number] = pair.start ? [0, pair.heel] : [path.length - pair.heel, path.length]
    ranges = ranges.flatMap(([a, b]) => {
      if (cut[1] <= a || cut[0] >= b) return [[a, b] as [number, number]]
      return [[a, Math.min(b, cut[0])], [Math.max(a, cut[1]), b]]
        .filter(([start, end]) => end - start > .001) as [number, number][]
    })
  }
  return ranges
}

function at(route: TrackRoute, distance: number, start: boolean): TrackPoint {
  const point = route.pointAt(start ? distance : route.length - distance)
  return start ? point : { ...point, angle: point.angle + Math.PI, slope: -point.slope }
}
function railPoint(point: TrackPoint, side: number, track: Track): THREE.Vector3 {
  return new THREE.Vector3(point.x - track.x - Math.sin(point.angle) * side * RAIL_CENTER,
    point.z, point.y - track.y + Math.cos(point.angle) * side * RAIL_CENTER)
}
function bladeGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((SEGMENTS + 1) * PROFILE.length * 3), 3).setUsage(THREE.DynamicDrawUsage))
  const indices: number[] = []
  for (let i = 0; i < SEGMENTS; i++) for (let j = 0; j < PROFILE.length; j++) {
    const next = (j + 1) % PROFILE.length, a = i * PROFILE.length + j, b = i * PROFILE.length + next
    const c = (i + 1) * PROFILE.length + j, d = (i + 1) * PROFILE.length + next
    indices.push(a, c, b, b, c, d)
  }
  for (let j = 1; j < PROFILE.length - 1; j++) {
    indices.push(0, j, j + 1)
    const end = SEGMENTS * PROFILE.length
    indices.push(end, end + j + 1, end + j)
  }
  geometry.setIndex(indices)
  return geometry
}
function ringCenter(blade: Blade, end: boolean): THREE.Vector3 {
  // Read the actual running-surface vertices, rather than an independent pose.
  const vertices = blade.mesh.geometry.getAttribute('position')
  const base = end ? SEGMENTS * PROFILE.length : 0
  return new THREE.Vector3().fromBufferAttribute(vertices, base + 6)
    .add(new THREE.Vector3().fromBufferAttribute(vertices, base + 7)).multiplyScalar(.5)
}
function placeBar(bar: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) {
  bar.position.copy(a).add(b).multiplyScalar(.5)
  bar.scale.set(.85, .65, a.distanceTo(b) + 1.2)
  bar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), b.clone().sub(a).normalize())
}

/** Paired rails, fixed heel pivots, and a shared stretcher bar for each toe. */
export class TurnoutPoints {
  readonly group = new THREE.Group()
  readonly pairs: RenderPair[]
  fraction: number
  target: number
  private from: number
  private started = 0
  private state: State

  constructor(private readonly track: Track, rail: THREE.Material, mechanism: THREE.Material) {
    this.state = track.switchState ?? 'straight'
    this.fraction = this.target = this.from = this.state === 'branch' ? 1 : 0
    this.group.name = 'moving-turnout-points'
    this.pairs = specsFor(track).map(spec => {
      const blades = [
        { route: spec.straight, stock: spec.branch, side: spec.bend, selected: 'straight' as const },
        { route: spec.branch, stock: spec.straight, side: -spec.bend as Side, selected: 'branch' as const },
      ].map(({ route, stock, side, selected }): Blade => {
        const toe = at(route, TOE, spec.start)
        const stockToe = at(stock, TOE, spec.start)
        // The stock rail is on the same side as this blade. Its inside face
        // touches the tapered tip; the other blade opens toward the gauge.
        const stockTip = railPoint(stockToe, side, track)
        const inward = new THREE.Vector3(Math.sin(stockToe.angle) * side, 0, -Math.cos(stockToe.angle) * side)
        const desired = stockTip.clone().addScaledVector(inward, HEAD_HALF + TIP_HALF + CLOSED_GAP)
        const closedDelta = desired.sub(railPoint(toe, side, track))
        const mesh = new THREE.Mesh(bladeGeometry(), rail)
        mesh.name = `point-blade-${spec.id}-${selected}`
        mesh.castShadow = mesh.receiveShadow = true
        this.group.add(mesh)
        return { route, side, selected, mesh, stockTip, inward, closedDelta, pair: spec }
      })
      const tieBar = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mechanism)
      tieBar.name = `point-tie-bar-${spec.id}`
      tieBar.castShadow = tieBar.receiveShadow = true
      this.group.add(tieBar)
      const pins = blades.map(blade => {
        const point = railPoint(at(blade.route, spec.heel, spec.start), blade.side, track)
        const pin = new THREE.Mesh(new THREE.CylinderGeometry(.9, .9, .8, 12), mechanism)
        pin.position.copy(point); pin.position.y += 4.85
        pin.name = `point-heel-hinge-${spec.id}-${blade.selected}`
        pin.castShadow = pin.receiveShadow = true
        this.group.add(pin)
        return pin
      })
      return { spec, blades, tieBar, pins }
    })
    this.render()
  }

  get animating() { return Math.abs(this.fraction - this.target) > 1e-6 }

  setState(state: State, now: number, settle = false) {
    const target = state === 'branch' ? 1 : 0
    if (settle) {
      this.state = state; this.fraction = this.from = this.target = target
      this.render()
      return
    }
    if (target === this.target) return
    this.update(now)
    this.state = state; this.from = this.fraction; this.target = target; this.started = now
  }

  update(now: number): boolean {
    if (!this.animating) return false
    // Reversing mid-throw starts from the currently rendered position.
    const progress = Math.min(1, Math.max(0, (now - this.started) / POINT_DURATION))
    const ease = progress * progress * (3 - 2 * progress)
    this.fraction = this.from + (this.target - this.from) * ease
    this.render()
    return true
  }

  private render() {
    for (const pair of this.pairs) {
      for (const blade of pair.blades) {
        const opening = blade.selected === 'straight' ? this.fraction : 1 - this.fraction
        const shift = blade.closedDelta.clone().addScaledVector(blade.inward, POINT_THROW * opening)
        const vertices = blade.mesh.geometry.getAttribute('position')
        for (let i = 0; i <= SEGMENTS; i++) {
          const t = i / SEGMENTS
          const point = at(blade.route, TOE + (pair.spec.heel - TOE) * t, pair.spec.start)
          const center = railPoint(point, blade.side, this.track).addScaledVector(shift, 1 - t)
          const taper = TIP_HALF / HEAD_HALF + (1 - TIP_HALF / HEAD_HALF) * Math.min(1, t * 1.35)
          const nx = -Math.sin(point.angle), nz = Math.cos(point.angle)
          PROFILE.forEach(([offset, height], j) => vertices.setXYZ(i * PROFILE.length + j,
            center.x + nx * offset * taper, center.y + height, center.z + nz * offset * taper))
        }
        vertices.needsUpdate = true
        blade.mesh.geometry.computeVertexNormals()
        blade.mesh.geometry.computeBoundingSphere()
      }
      const a = ringCenter(pair.blades[0], false), b = ringCenter(pair.blades[1], false)
      a.y -= 2.2; b.y -= 2.2
      placeBar(pair.tieBar, a, b)
    }
  }

  snapshot(toLayout: (point: THREE.Vector3) => { x: number; y: number; z: number }) {
    for (const pair of this.pairs) pair.tieBar.updateMatrix()
    return {
      id: this.track.id, kind: this.track.kind, state: this.state,
      fraction: this.fraction, target: this.target, animating: this.animating,
      pairs: this.pairs.map(pair => ({
        id: pair.spec.id,
        blades: pair.blades.map(blade => {
          const tip = ringCenter(blade, false), heel = ringCenter(blade, true)
          const stock = blade.stockTip.clone(); stock.y += 7.35
          const gap = tip.clone().sub(stock).dot(blade.inward) - HEAD_HALF - TIP_HALF
          return { route: blade.route.route, side: blade.side,
            closed: gap < .1, tip: toLayout(tip), heel: toLayout(heel), stockTip: toLayout(stock), gap }
        }),
        tieBar: {
          first: toLayout(new THREE.Vector3(0, 0, -.5).applyMatrix4(pair.tieBar.matrix)),
          second: toLayout(new THREE.Vector3(0, 0, .5).applyMatrix4(pair.tieBar.matrix)),
        },
      })),
    }
  }
}
