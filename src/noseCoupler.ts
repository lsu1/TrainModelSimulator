import * as THREE from 'three'
import { NOSE_COUPLER_PROFILES } from './couplingTypes'
import type { NoseCouplingState, NoseCouplerProfile } from './couplingTypes'
import type { TrainSpec, TrainType } from './trains'

type CouplingType = 'e5' | 'e6'
type Surface = (x: number, theta: number) => THREE.Vector3
type Vertex = Record<string, number[]>
interface NoseRig {
  profile: NoseCouplerProfile
  covers: { side: -1 | 1; group: THREE.Group }[]
  pivot: THREE.Object3D
  face: THREE.Object3D
  head: THREE.Mesh
  gimbal: THREE.Group
  slide: THREE.Group
  state: NoseCouplingState
}

const rigs = new WeakMap<THREE.Object3D, NoseRig>()
const partitions = new Map<string, { stationary: THREE.BufferGeometry | null; fragments: (THREE.BufferGeometry | null)[] }>()
const CLOSED: NoseCouplingState = { open: 0, extension: 0, locked: false }
const SURFACE_NAMES = new Set([
  'continuous-rounded-body-and-sculpted-nose',
  'emerald-green-upper-body-and-duckbill',
  'carmine-red-roof-and-pointed-nose',
  'rounded-silver-nose-chin-and-coupler-cover',
  'pink-belt-line',
  'silver-side-belt-below-windows',
])

/** Physical cab roles are retained even in shortened play formations. */
export function isNoseCouplingCar(type: TrainType, index: number, total: number): boolean {
  return type === 'e5' && index === 0 || type === 'e6' && index === total - 1
}

export function isMechanicalNoseCouplerContact(object: THREE.Object3D): boolean {
  return object instanceof THREE.Mesh && object.userData.mechanicalCouplerContact === true
}

function interpolateVertex(first: Vertex, second: Vertex, t: number): Vertex {
  return Object.fromEntries(Object.keys(first).map(name => [name, first[name].map((value, index) => value + (second[name][index] - value) * t)]))
}

function clipPolygon(vertices: Vertex[], axis: 0 | 2, boundary: number, direction: -1 | 1): Vertex[] {
  const result: Vertex[] = []
  if (!vertices.length) return result
  let previous = vertices[vertices.length - 1]
  let previousDistance = direction * (previous.position[axis] - boundary)
  for (const current of vertices) {
    const distance = direction * (current.position[axis] - boundary)
    if ((distance >= 0) !== (previousDistance >= 0)) {
      result.push(interpolateVertex(previous, current, previousDistance / (previousDistance - distance)))
    }
    if (distance >= 0) result.push(current)
    previous = current; previousDistance = distance
  }
  return result
}

/** Cut actual triangles, not sampled replacement surfaces. Paint, normals and
 * texture coordinates therefore meet at exactly the existing closed outline.
 */
function cutGeometry(source: THREE.BufferGeometry, planes: [0 | 2, number, -1 | 1][]): THREE.BufferGeometry | null {
  const attributes = Object.entries(source.attributes) as [string, THREE.BufferAttribute][]
  const output: Record<string, number[]> = Object.fromEntries(attributes.map(([name]) => [name, []]))
  const count = source.index?.count ?? source.getAttribute('position').count
  for (let triangle = 0; triangle < count; triangle += 3) {
    let polygon: Vertex[] = [0, 1, 2].map(offset => {
      const index = source.index ? source.index.getX(triangle + offset) : triangle + offset
      return Object.fromEntries(attributes.map(([name, attribute]) => [name,
        Array.from({ length: attribute.itemSize }, (_, component) => attribute.getComponent(index, component)),
      ]))
    })
    for (const [axis, boundary, direction] of planes) polygon = clipPolygon(polygon, axis, boundary, direction)
    for (let index = 1; index < polygon.length - 1; index++) {
      const vertices = [polygon[0], polygon[index], polygon[index + 1]]
      const a = new THREE.Vector3(...vertices[0].position as [number, number, number])
      const b = new THREE.Vector3(...vertices[1].position as [number, number, number])
      const c = new THREE.Vector3(...vertices[2].position as [number, number, number])
      if (b.sub(a).cross(c.sub(a)).lengthSq() < 1e-16) continue
      for (const vertex of vertices) for (const [name] of attributes) output[name].push(...vertex[name])
    }
  }
  if (!output.position.length) return null
  const geometry = new THREE.BufferGeometry()
  for (const [name, attribute] of attributes) geometry.setAttribute(name, new THREE.Float32BufferAttribute(output[name], attribute.itemSize))
  geometry.computeBoundingBox(); geometry.computeBoundingSphere()
  return geometry
}

function part(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], name: string, role: string) {
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = name; mesh.castShadow = mesh.receiveShadow = true
  mesh.userData.noseCouplingPart = role
  parent.add(mesh)
  return mesh
}

function box(parent: THREE.Object3D, size: [number, number, number], position: [number, number, number], material: THREE.Material, name: string, role: string) {
  const mesh = part(parent, new THREE.BoxGeometry(...size), material, name, role)
  mesh.position.set(...position)
  return mesh
}

function partitionSurface(object: THREE.Mesh, cutX: number, covers: NoseRig['covers'], innerMaterial: THREE.Material, key: string) {
  const original = object.geometry
  original.computeBoundingBox()
  if (original.boundingBox!.max.x <= cutX) return
  let template = partitions.get(key)
  if (!template) {
    template = {
      stationary: cutGeometry(original, [[0, cutX, -1]]),
      fragments: covers.map(({ side }) => cutGeometry(original, [[0, cutX, 1], [2, 0, side]])),
    }
    partitions.set(key, template)
  }
  // Templates never enter a scene. Each instance owns its clones, so disposing
  // a safety-only model cannot invalidate another car's rendered resources.
  const stationary = template.stationary?.clone() ?? null
  const fragments = covers.map(({ side, group }, index) => ({ side, group, geometry: template.fragments[index]?.clone() ?? null }))
  if (stationary) object.geometry = stationary
  else object.removeFromParent()
  for (const { side, group, geometry } of fragments) {
    if (!geometry) continue
    const skin = part(group, geometry, object.material, `${object.name}-opening-cover-${side === 1 ? 'left' : 'right'}`, 'cover')
    skin.userData.sourceSurface = object.name
    if (object.name === 'continuous-rounded-body-and-sculpted-nose') {
      // Retained rigid inner skins make the cap a panel rather than a single
      // painted face. These remain present when naturally stowed in the body.
      const inner = geometry.clone(), vertices = inner.getAttribute('position'), normals = inner.getAttribute('normal')
      for (let i = 0; i < vertices.count; i++) {
        vertices.setXYZ(i, vertices.getX(i) - normals.getX(i) * .18, vertices.getY(i) - normals.getY(i) * .18, vertices.getZ(i) - normals.getZ(i) * .18)
      }
      inner.computeBoundingBox(); inner.computeBoundingSphere()
      part(group, inner, innerMaterial, `nose-cover-inner-skin-${side === 1 ? 'left' : 'right'}`, 'cover-inner')
    }
  }
  original.dispose()
}

function addCavity(parent: THREE.Object3D, profile: NoseCouplerProfile, spec: TrainSpec, surface: Surface, material: THREE.Material) {
  const cutX = spec.length / 2 - profile.cutBack, backX = spec.length / 2 - profile.mountInset - 4
  const centerY = (surface(cutX, Math.PI / 2).y + surface(cutX, -Math.PI / 2).y) / 2
  const innerPoint = (x: number, theta: number) => {
    const point = surface(x, theta)
    point.y = centerY + (point.y - centerY) * .92; point.z *= .94
    return point
  }
  // Individual wall sectors preserve the open void in physical convex-part
  // checks; a single convex hull around the whole tunnel would fill the hole.
  for (let sector = 0; sector < 24; sector++) {
    const a = sector / 24 * Math.PI * 2, b = (sector + 1) / 24 * Math.PI * 2
    const points = [innerPoint(backX, a), innerPoint(cutX, a), innerPoint(backX, b), innerPoint(cutX, b)]
    const geometry = new THREE.BufferGeometry().setFromPoints(points).setIndex([0, 1, 2, 2, 1, 3])
    geometry.computeVertexNormals()
    part(parent, geometry, material, `nose-cavity-lining-${sector}`, 'cavity')
    const rimPoints = [surface(cutX, a), surface(cutX, b), innerPoint(cutX, a), innerPoint(cutX, b)]
    rimPoints.forEach(point => { point.x -= .08 })
    const rim = new THREE.BufferGeometry().setFromPoints(rimPoints).setIndex([0, 2, 1, 1, 2, 3])
    rim.computeVertexNormals()
    part(parent, rim, material, `nose-retained-aperture-rim-${sector}`, 'rim')
  }
}

/** Attach only to the coupling-equipped E514/E611 cab. All animated pieces
 * stay in the mesh graph. Paths are photographic approximations, documented
 * in docs/shinkansen-nose-coupling.md, rather than measured mechanism data.
 */
export function attachNoseCoupler(
  car: THREE.Group, exterior: THREE.Group, spec: TrainSpec, type: CouplingType,
  surface: Surface, initial: NoseCouplingState = CLOSED,
) {
  const profile = NOSE_COUPLER_PROFILES[type]
  const inner = new THREE.MeshStandardMaterial({ color: '#38414a', metalness: .36, roughness: .62, side: THREE.DoubleSide })
  const steel = new THREE.MeshStandardMaterial({ color: '#a1a8ac', metalness: .74, roughness: .39 })
  const graphite = new THREE.MeshStandardMaterial({ color: '#242d34', metalness: .43, roughness: .62 })
  const covers: NoseRig['covers'] = [-1, 1].map(side => {
    const group = new THREE.Group(); group.name = `nose-opening-cover-${side === 1 ? 'left' : 'right'}`
    group.userData.noseCouplingPart = 'cover-group'; exterior.add(group)
    return { side: side as -1 | 1, group }
  })
  const surfaces = exterior.children.filter(object => object instanceof THREE.Mesh && SURFACE_NAMES.has(object.name)) as THREE.Mesh[]
  const geometryKey = `${type}:${spec.length}:${spec.width}:${spec.height}:${spec.noseLength}`
  surfaces.forEach((object, index) => partitionSurface(object, spec.length / 2 - profile.cutBack, covers, inner, `${geometryKey}:${index}:${object.name}`))
  addCavity(exterior, profile, spec, surface, inner)

  const mountX = spec.length / 2 - profile.mountInset
  const pivot = new THREE.Object3D(); pivot.name = 'nose-coupler-pivot'; pivot.position.set(mountX, profile.height, 0); exterior.add(pivot)
  box(exterior, [3.2, 2.5, 4.4], [mountX - 1.0, profile.height, 0], graphite, 'nose-coupler-structural-mount', 'mount')
  const gimbal = new THREE.Group(); gimbal.name = 'nose-coupler-gimbal'; gimbal.position.copy(pivot.position); exterior.add(gimbal)
  // A fixed socket and a rigid sliding arm, rather than a stretched drawbar.
  box(gimbal, [4.2, 1.35, 1.65], [-.5, 0, 0], graphite, 'nose-coupler-guide-socket', 'socket')
  const slide = new THREE.Group(); slide.name = 'nose-coupler-extension-slide'; gimbal.add(slide)
  box(slide, [profile.extensionLength - 2.0, .86, 1.0], [(2.6 - profile.extensionLength) / 2, 0, 0], steel, 'nose-mechanical-coupler-shank', 'shank')
  const head = box(slide, [2.6, 2.85, 3.45], [1.3, 0, 0], steel, 'nose-mechanical-coupler-head', 'head')
  head.userData.mechanicalCouplerContact = true
  // Connection details sit behind the mating face; no extra collision part
  // receives a blanket exemption for the coupling pair.
  box(slide, [.35, .45, .85], [.75, .97, 2.08], graphite, 'nose-coupler-electrical-connector', 'connector')
  box(slide, [.55, .55, .55], [.45, -.85, -1.9], graphite, 'nose-coupler-air-connector', 'connector')
  const face = new THREE.Object3D(); face.name = 'nose-coupler-mating-face'; face.position.x = 2.6; slide.add(face)
  const rig: NoseRig = { profile, covers, pivot, face, head, gimbal, slide, state: { open: -1, extension: -1, locked: false } }
  rigs.set(car, rig)
  car.userData.noseCouplingEnd = type === 'e5' ? 'car-10' : 'car-11'
  car.userData.noseCouplingProfile = { ...profile }
  updateNoseCoupler(car, initial)
}

function unit(value: number): number { return Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0 }

/** Covers translate as rigid pieces: clear the seam, move apart, then retract
 * inside the retained shell. Series have distinct distances and timing.
 */
export function updateNoseCoupler(car: THREE.Object3D, state: NoseCouplingState): boolean {
  const rig = rigs.get(car)
  if (!rig) return false
  const next: NoseCouplingState = { open: unit(state.open), extension: unit(state.extension), locked: state.locked === true }
  if (state.axis && [state.axis.x, state.axis.y, state.axis.z].every(Number.isFinite)) {
    const direction = new THREE.Vector3(state.axis.x, state.axis.y, state.axis.z)
    if (direction.lengthSq() > 1e-12) {
      direction.normalize()
      next.axis = { x: direction.x, y: direction.y, z: direction.z }
    }
  }
  if (next.open === rig.state.open && next.extension === rig.state.extension && next.locked === rig.state.locked
    && next.axis?.x === rig.state.axis?.x && next.axis?.y === rig.state.axis?.y && next.axis?.z === rig.state.axis?.z) return false
  rig.state = next
  const e5 = rig.profile.type === 'e5'
  const clear = THREE.MathUtils.smoothstep(next.open, 0, e5 ? .18 : .22)
  const spread = THREE.MathUtils.smoothstep(next.open, e5 ? .14 : .17, e5 ? .48 : .55)
  const retract = THREE.MathUtils.smoothstep(next.open, e5 ? .44 : .51, 1)
  for (const { side, group } of rig.covers) {
    group.position.set((e5 ? 1.1 : .9) * clear - (rig.profile.cutBack + (e5 ? 5.8 : 5.0)) * retract,
      -(e5 ? .12 : .24) * retract, side * ((e5 ? 2.25 : 1.95) * spread - (e5 ? 1.4 : .85) * retract))
  }
  rig.slide.position.x = (rig.profile.extensionLength - 2.6) * next.extension
  rig.gimbal.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), next.axis
    ? new THREE.Vector3(next.axis.x, next.axis.y, next.axis.z) : new THREE.Vector3(1, 0, 0))
  rig.head.userData.locked = next.locked
  car.userData.noseCouplingState = { ...next }
  car.updateMatrixWorld(true)
  return true
}

/** Articulation rotates the complete rigid shank/head about its body mount.
 * The target is car-local, matching the formation solver's shared joint face.
 */
export function orientNoseCoupler(car: THREE.Object3D, target: THREE.Vector3): boolean {
  const rig = rigs.get(car)
  if (!rig) return false
  car.updateMatrixWorld(true)
  const targetWorld = car.localToWorld(target.clone())
  const direction = rig.gimbal.parent!.worldToLocal(targetWorld).sub(rig.gimbal.position)
  if (direction.lengthSq() < 1e-12) return false
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), direction.normalize())
  if (rig.gimbal.quaternion.angleTo(quaternion) < 1e-9) return false
  rig.gimbal.quaternion.copy(quaternion); car.updateMatrixWorld(true)
  return true
}

export interface NoseCouplerDiagnostics {
  type: CouplingType
  state: NoseCouplingState
  coverTransforms: { side: 'left' | 'right'; position: [number, number, number]; quaternion: [number, number, number, number]; scale: [number, number, number] }[]
  pivot: THREE.Vector3
  matingFace: THREE.Vector3
  mechanicalHead: THREE.Vector3
}

/** Coordinates are derived from current rendered transforms, not ideal tips. */
export function getNoseCouplerDiagnostics(car: THREE.Object3D): NoseCouplerDiagnostics | null {
  const rig = rigs.get(car)
  if (!rig) return null
  car.updateMatrixWorld(true)
  const localPosition = (object: THREE.Object3D) => car.worldToLocal(object.getWorldPosition(new THREE.Vector3()))
  return {
    type: rig.profile.type, state: { ...rig.state },
    coverTransforms: rig.covers.map(({ side, group }) => ({
      side: side === 1 ? 'left' : 'right', position: group.position.toArray() as [number, number, number],
      quaternion: group.quaternion.toArray() as [number, number, number, number], scale: group.scale.toArray() as [number, number, number],
    })),
    pivot: localPosition(rig.pivot), matingFace: localPosition(rig.face), mechanicalHead: localPosition(rig.head),
  }
}
