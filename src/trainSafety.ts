import { KATO_CATALOG } from './catalog'
import * as THREE from 'three'
import { solveConsistPoses } from './consistPose'
import type { CarPose, PoseVector, ConsistPoses } from './consistPose'
import { NOSE_COUPLER_PROFILES } from './couplingTypes'
import type { NoseCouplingState } from './couplingTypes'
import { createShinkansenCar } from './shinkansenModel'
import { updateNoseCoupler } from './noseCoupler'
import { convexShapesIntersect } from './convexSafety'
import type { TrainSnapshot } from './fleet'
import { shinkansenSurface } from './shinkansenModel'
import { createTrainCar, disposeTrainModel } from './trainModel'
import { pathsFor, pointAt } from './track'
import type { Track } from './track'
import { getTrainCarSpec } from './trains'

/** Clearance between independent sets; joined mechanical heads use actual contact geometry. */
export const TRAIN_SAFETY_GAP = 2
const RAIL_TOP = 7.35
const EPSILON = 1e-7
type PhysicalTrain = TrainSnapshot & { noseCoupling?: NoseCouplingState }
const ITEMS = new Map(KATO_CATALOG.map(item => [item.kind, item]))

export interface SafetyBounds {
  minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number
}
export interface BodyVolume {
  carIndex: number
  center: PoseVector
  axes: [PoseVector, PoseVector, PoseVector]
  half: [number, number, number]
  bounds: SafetyBounds
}
export interface TrainFootprint {
  volumes: BodyVolume[]
  bounds: SafetyBounds
  complete: boolean
  visibleCars: number
  rearOffset: number
}

interface PhysicalBodyVolume extends BodyVolume { vertices: PoseVector[]; matingHead: boolean; mechanical: boolean }
/** Physical hulls are lazy. Independent-train reserves retain their original
 * headroom and expand to contain opening covers and articulated hardware. */
const SELF_COLLISION_PARTS = new WeakMap<TrainFootprint, {
  bounds: () => BodyVolume[]
  parts: (carIndex: number) => PhysicalBodyVolume[]
}>()

const emptyBounds = (): SafetyBounds => ({ minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity })
const dot = (a: PoseVector, b: PoseVector) => a.x * b.x + a.y * b.y + a.z * b.z
const subtract = (a: PoseVector, b: PoseVector): PoseVector => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const cross = (a: PoseVector, b: PoseVector): PoseVector => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x })
const magnitude = (v: PoseVector) => Math.hypot(v.x, v.y, v.z)

function boundsOf(center: PoseVector, axes: BodyVolume['axes'], half: BodyVolume['half']): SafetyBounds {
  const extent = (key: 'x' | 'y' | 'z') => axes.reduce((sum, axis, index) => sum + Math.abs(axis[key]) * half[index], 0)
  const x = extent('x'), y = extent('y'), z = extent('z')
  return { minX: center.x - x, maxX: center.x + x, minY: center.y - y, maxY: center.y + y, minZ: center.z - z, maxZ: center.z + z }
}
function merge(target: SafetyBounds, source: SafetyBounds): void {
  target.minX = Math.min(target.minX, source.minX); target.maxX = Math.max(target.maxX, source.maxX)
  target.minY = Math.min(target.minY, source.minY); target.maxY = Math.max(target.maxY, source.maxY)
  target.minZ = Math.min(target.minZ, source.minZ); target.maxZ = Math.max(target.maxZ, source.maxZ)
}
export function safetyBoundsIntersect(a: SafetyBounds, b: SafetyBounds, margin = 0): boolean {
  return a.minX < b.maxX + margin - EPSILON && b.minX < a.maxX + margin - EPSILON
    && a.minY < b.maxY + margin - EPSILON && b.minY < a.maxY + margin - EPSILON
    && a.minZ < b.maxZ + margin - EPSILON && b.minZ < a.maxZ + margin - EPSILON
}

/** 3D separating axes distinguish parallel lanes, pitch and elevated crossings. */
export function bodyVolumesIntersect(a: BodyVolume, b: BodyVolume, margin = 0): boolean {
  if (!safetyBoundsIntersect(a.bounds, b.bounds, margin)) return false
  const between = subtract(b.center, a.center)
  const axes = [...a.axes, ...b.axes, ...a.axes.flatMap(first => b.axes.map(second => cross(first, second)))]
  return axes.every(axis => {
    const length = magnitude(axis)
    if (length < 1e-9) return true
    const radius = (volume: BodyVolume) => volume.axes.reduce((sum, direction, index) => sum + volume.half[index] * Math.abs(dot(direction, axis)), 0)
    return Math.abs(dot(between, axis)) < radius(a) + radius(b) + margin * length - EPSILON
  })
}

type LocalVolume = { along: number; halfLength: number; halfWidth: number; bottom: number; top: number }
const LOCAL_VOLUMES = new Map<string, LocalVolume[]>()
interface LocalPhysicalVolume extends LocalVolume { across: number; vertices: PoseVector[]; matingHead: boolean; mechanical: boolean }
const LOCAL_PHYSICAL_VOLUMES = new Map<string, LocalPhysicalVolume[]>()
const LOCAL_SELF_BOUNDS = new Map<string, LocalVolume & { across: number }>()
const INTENTIONAL_NOSE_CONTACTS = new WeakMap<TrainFootprint, readonly (readonly [number, number])[]>()
function noseStateKey(train: PhysicalTrain, index: number): string {
  const state = (train as TrainSnapshot & { noseCoupling?: NoseCouplingState }).noseCoupling
  const eligible = train.type === 'e5' && index === 0 || train.type === 'e6' && index === train.carCount - 1
  return state && eligible ? `:${state.open}:${state.extension}:${state.locked}` : ''
}
const NOSE_STATIONS = {
  e5: [0, .14, .27, .40, .59, .77, .91, 1],
  e6: [0, .13, .27, .44, .64, .82, .94, 1],
  e7: [0, .17, .35, .53, .72, .88, 1],
}

/** Separate tapered nose volumes follow the existing loft without editing it. */
function localVolumes(train: PhysicalTrain, index: number): LocalVolume[] {
  const key = `${train.type}:${train.carCount}:${index}`
  const cached = LOCAL_VOLUMES.get(key)
  if (cached) return cached
  const spec = getTrainCarSpec(train.type, index, train.carCount)
  const noseDirection = index === train.carCount - 1 ? -1 : 1
  const halfLength = spec.length / 2, start = halfLength - spec.noseLength
  const result: LocalVolume[] = []
  // Includes wheels, external door details and rooftop equipment. The vertical
  // allowance is intentionally conservative, as in the existing clearance audit.
  if (!spec.noseLength || train.type === 'e235') {
    result.push({ along: 0, halfLength, halfWidth: spec.width / 2 + .2, bottom: 0, top: 45 })
  } else {
    result.push({ along: (-halfLength + start) / 2 * noseDirection, halfLength: (halfLength + start) / 2, halfWidth: spec.width / 2 + .2, bottom: 0, top: 45 })
    const stations = NOSE_STATIONS[train.type]
    for (let section = 0; section + 1 < stations.length; section++) {
      const from = start + spec.noseLength * stations[section], to = start + spec.noseLength * stations[section + 1]
      // Section interpolation is bounded by its endpoint widths. Keep the
      // wider endpoint and allow for painted surface offsets/lighting details.
      const width = Math.max(Math.abs(shinkansenSurface(spec, train.type, from, 0).z), Math.abs(shinkansenSurface(spec, train.type, to, 0).z))
      result.push({ along: (from + to) / 2 * noseDirection, halfLength: (to - from) / 2, halfWidth: width + .25, bottom: 0, top: 45 })
    }
  }
  LOCAL_VOLUMES.set(key, result)
  return result
}

function worldVolume(pose: CarPose, local: LocalVolume, carIndex: number): BodyVolume {
  const horizontal = Math.hypot(pose.direction.x, pose.direction.y)
  const forward = pose.direction
  const right = { x: -forward.y / horizontal, y: forward.x / horizontal, z: 0 }
  const up = cross(forward, right)
  const height = (local.bottom + local.top) / 2
  const center = {
    x: pose.center.x + forward.x * local.along + up.x * height,
    y: pose.center.y + forward.y * local.along + up.y * height,
    z: pose.center.z + RAIL_TOP + forward.z * local.along + up.z * height,
  }
  const axes: BodyVolume['axes'] = [forward, right, up]
  const half: BodyVolume['half'] = [local.halfLength, local.halfWidth, (local.top - local.bottom) / 2]
  return { carIndex, center, axes, half, bounds: boundsOf(center, axes, half) }
}

/** The conservative 45 mm swept reserve contains empty space above the roof.
 * It is useful between independent trains, but pitches that empty space into
 * the next coupled car at a grade change. Physical self-contact instead uses
 * the same original meshes as the renderer, preserving rounded body ends and
 * the actual positions of antennas, collectors and air conditioners.
 * Each instance remains separate: gaps between fittings are not filled in.
 */
interface PhysicalTemplate { car: THREE.Group; stationary: LocalPhysicalVolume[]; moving: THREE.Mesh[] }
const PHYSICAL_TEMPLATES = new Map<string, PhysicalTemplate>()
function meshPhysicalVolumes(object: THREE.Mesh): LocalPhysicalVolume[] {
  const positions = object.geometry.getAttribute('position')
  if (!positions) return []
  const point = new THREE.Vector3(), instanceMatrix = new THREE.Matrix4(), transform = new THREE.Matrix4()
  const instances = object instanceof THREE.InstancedMesh ? object.count : 1, parts: LocalPhysicalVolume[] = []
  let mechanical = false
  for (let ancestor: THREE.Object3D | null = object; ancestor; ancestor = ancestor.parent) if (ancestor.name === 'nose-coupler-gimbal') mechanical = true
  for (let instance = 0; instance < instances; instance++) {
    transform.copy(object.matrixWorld)
    if (object instanceof THREE.InstancedMesh) { object.getMatrixAt(instance, instanceMatrix); transform.multiply(instanceMatrix) }
    const rays = new Map<string, [PoseVector, PoseVector]>()
    for (let vertex = 0; vertex < positions.count; vertex++) {
      point.fromBufferAttribute(positions, vertex).applyMatrix4(transform)
      const value = { x: point.x, y: point.z, z: point.y }, ray = `${value.y}:${value.z}`, range = rays.get(ray)
      if (!range) rays.set(ray, [value, value])
      else { if (value.x < range[0].x) range[0] = value; if (value.x > range[1].x) range[1] = value }
    }
    const vertices = [...rays.values()].flatMap(([first, last]) => first === last ? [first] : [first, last])
    if (!vertices.length) continue
    const bounds = emptyBounds()
    vertices.forEach(vertex => merge(bounds, { minX: vertex.x, maxX: vertex.x, minY: vertex.y, maxY: vertex.y, minZ: vertex.z, maxZ: vertex.z }))
    parts.push({ along: (bounds.minX + bounds.maxX) / 2, halfLength: (bounds.maxX - bounds.minX) / 2,
      across: (bounds.minY + bounds.maxY) / 2, halfWidth: (bounds.maxY - bounds.minY) / 2,
      bottom: bounds.minZ, top: bounds.maxZ, vertices, matingHead: object.userData.mechanicalCouplerContact === true, mechanical })
  }
  return parts
}
function physicalLocalVolumes(train: PhysicalTrain, index: number): LocalPhysicalVolume[] {
  const baseKey = `${train.type}:${train.carCount}:${index}`, key = baseKey + noseStateKey(train, index)
  const cached = LOCAL_PHYSICAL_VOLUMES.get(key)
  if (cached) return cached
  const state = (train as TrainSnapshot & { noseCoupling?: NoseCouplingState }).noseCoupling
  const eligible = state && (train.type === 'e5' && index === 0 || train.type === 'e6' && index === train.carCount - 1)
  let template = PHYSICAL_TEMPLATES.get(baseKey)
  if (!template) {
    const car = eligible && (train.type === 'e5' || train.type === 'e6')
      ? createShinkansenCar(index, train.carCount, train.type, { open: 0, extension: 0, locked: false })
      : createTrainCar(index, train.carCount, train.type)
    car.updateMatrixWorld(true)
    const stationary: LocalPhysicalVolume[] = [], moving: THREE.Mesh[] = []
    car.traverse(object => {
      if (!(object instanceof THREE.Mesh) || /^(?:covered-)?coupler-mount-(?:front|rear)$/.test(object.name)) return
      for (let ancestor: THREE.Object3D | null = object; ancestor; ancestor = ancestor.parent) if (!ancestor.visible) return
      let dynamic = false
      for (let ancestor: THREE.Object3D | null = object; ancestor; ancestor = ancestor.parent)
        if (ancestor.name === 'nose-coupler-gimbal' || ancestor.name === 'nose-opening-cover-left' || ancestor.name === 'nose-opening-cover-right') dynamic = true
      if (dynamic) moving.push(object)
      else stationary.push(...meshPhysicalVolumes(object))
    })
    template = { car, stationary, moving }
    if (PHYSICAL_TEMPLATES.size >= 32) { const oldest = PHYSICAL_TEMPLATES.keys().next().value!; disposeTrainModel(PHYSICAL_TEMPLATES.get(oldest)!.car); PHYSICAL_TEMPLATES.delete(oldest) }
    if (moving.length) PHYSICAL_TEMPLATES.set(baseKey, template)
    else disposeTrainModel(car)
  }
  // Cut and classify the real body just once. Animated frames transform only
  // retained cap skins and mechanical parts, rather than rebuilding a train.
  if (eligible) updateNoseCoupler(template.car, { ...state, axis: undefined })
  else updateNoseCoupler(template.car, { open: 0, extension: 0, locked: false })
  const parts = [...template.stationary, ...template.moving.flatMap(meshPhysicalVolumes)]
  if (LOCAL_PHYSICAL_VOLUMES.size >= 512) LOCAL_PHYSICAL_VOLUMES.delete(LOCAL_PHYSICAL_VOLUMES.keys().next().value!)
  LOCAL_PHYSICAL_VOLUMES.set(key, parts)
  return parts
}

/** Unlike the independent-train reserve, this broad phase includes every
 * retained mesh protrusion, including nose paint and end gangway frames. */
function physicalLocalBounds(train: PhysicalTrain, index: number): LocalVolume & { across: number } {
  const key = `${train.type}:${train.carCount}:${index}${noseStateKey(train, index)}`
  const cached = LOCAL_SELF_BOUNDS.get(key)
  if (cached) return cached
  const parts = physicalLocalVolumes(train, index)
  const bounds = emptyBounds()
  for (const part of parts) merge(bounds, {
    minX: part.along - part.halfLength, maxX: part.along + part.halfLength,
    minY: part.across - part.halfWidth, maxY: part.across + part.halfWidth,
    minZ: part.bottom, maxZ: part.top,
  })
  const local = {
    along: (bounds.minX + bounds.maxX) / 2, halfLength: (bounds.maxX - bounds.minX) / 2,
    across: (bounds.minY + bounds.maxY) / 2, halfWidth: (bounds.maxY - bounds.minY) / 2,
    bottom: bounds.minZ, top: bounds.maxZ,
  }
  if (LOCAL_SELF_BOUNDS.size >= 512) LOCAL_SELF_BOUNDS.delete(LOCAL_SELF_BOUNDS.keys().next().value!)
  LOCAL_SELF_BOUNDS.set(key, local)
  return local
}

function offsetWorldVolume(pose: CarPose, local: LocalVolume & { across: number }, carIndex: number): BodyVolume {
  const volume = worldVolume(pose, local, carIndex)
  const right = volume.axes[1]
  volume.center.x += right.x * local.across; volume.center.y += right.y * local.across
  volume.bounds = boundsOf(volume.center, volume.axes, volume.half)
  return volume
}

function orientedLocalPhysicalVolume(original: LocalPhysicalVolume, carIndex: number, train: PhysicalTrain): LocalPhysicalVolume {
  let local = original
  const state = (train as TrainSnapshot & { noseCoupling?: NoseCouplingState }).noseCoupling
  if (local.mechanical && state?.axis && (train.type === 'e5' || train.type === 'e6')) {
    const sign = train.type === 'e6' ? -1 : 1, spec = getTrainCarSpec(train.type, carIndex, train.carCount)
    const profile = NOSE_COUPLER_PROFILES[train.type]
    const pivot = new THREE.Vector3(sign * (spec.length / 2 - profile.mountInset), 0, profile.height)
    const axis = new THREE.Vector3(sign * state.axis.x, sign * state.axis.z, state.axis.y).normalize()
    const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(sign, 0, 0), axis)
    const vertices = local.vertices.map(vertex => { const v = new THREE.Vector3(vertex.x, vertex.y, vertex.z).sub(pivot).applyQuaternion(rotation).add(pivot); return { x: v.x, y: v.y, z: v.z } })
    const bounds = emptyBounds()
    vertices.forEach(vertex => merge(bounds, { minX: vertex.x, maxX: vertex.x, minY: vertex.y, maxY: vertex.y, minZ: vertex.z, maxZ: vertex.z }))
    local = { ...local, vertices, along: (bounds.minX + bounds.maxX) / 2, halfLength: (bounds.maxX - bounds.minX) / 2, across: (bounds.minY + bounds.maxY) / 2, halfWidth: (bounds.maxY - bounds.minY) / 2, bottom: bounds.minZ, top: bounds.maxZ }
  }
  return local
}

function physicalLocalBoundsWithAxis(train: PhysicalTrain, index: number): LocalVolume & { across: number } {
  const base = physicalLocalBounds(train, index), state = (train as TrainSnapshot & { noseCoupling?: NoseCouplingState }).noseCoupling
  if (!state?.axis) return base
  const bounds: SafetyBounds = { minX: base.along - base.halfLength, maxX: base.along + base.halfLength, minY: base.across - base.halfWidth, maxY: base.across + base.halfWidth, minZ: base.bottom, maxZ: base.top }
  for (const part of physicalLocalVolumes(train, index)) if (part.mechanical) {
    const moved = orientedLocalPhysicalVolume(part, index, train)
    merge(bounds, { minX: moved.along - moved.halfLength, maxX: moved.along + moved.halfLength, minY: moved.across - moved.halfWidth, maxY: moved.across + moved.halfWidth, minZ: moved.bottom, maxZ: moved.top })
  }
  return { along: (bounds.minX + bounds.maxX) / 2, halfLength: (bounds.maxX - bounds.minX) / 2, across: (bounds.minY + bounds.maxY) / 2, halfWidth: (bounds.maxY - bounds.minY) / 2, bottom: bounds.minZ, top: bounds.maxZ }
}

function physicalWorldVolume(pose: CarPose, original: LocalPhysicalVolume, carIndex: number, train: PhysicalTrain): PhysicalBodyVolume {
  const local = orientedLocalPhysicalVolume(original, carIndex, train)
  const volume = offsetWorldVolume(pose, local, carIndex)
  const [forward, right, up] = volume.axes
  const vertices = local.vertices.map(vertex => ({
    x: pose.center.x + forward.x * vertex.x + right.x * vertex.y + up.x * vertex.z,
    y: pose.center.y + forward.y * vertex.x + right.y * vertex.y + up.y * vertex.z,
    z: pose.center.z + RAIL_TOP + forward.z * vertex.x + up.z * vertex.z,
  }))
  return { ...volume, vertices, matingHead: local.matingHead, mechanical: local.mechanical }
}

export function trainFootprint(tracks: Track[], train: PhysicalTrain): TrainFootprint {
  const bounds = emptyBounds()
  if (!train.position) return { volumes: [], bounds, complete: false, visibleCars: 0, rearOffset: 0 }
  return trainFootprintFromPoses(train, solveConsistPoses(tracks, train.position, train.cabForward, train.carCount, train.type))
}

/** Mixed formations supply rail-constrained member poses from their shared solver. */
export function trainFootprintFromPoses(train: PhysicalTrain, poses: ConsistPoses): TrainFootprint {
  const bounds = emptyBounds()
  const actualBounds = new Map<number, LocalVolume & { across: number }>()
  const localBounds = (index: number) => { let result = actualBounds.get(index); if (!result) { result = physicalLocalBoundsWithAxis(train, index); actualBounds.set(index, result) } return result }
  const volumes = poses.cars.flatMap((pose, index) => pose ? localVolumes(train, index).map(local => worldVolume(pose, local, index)) : [])
  // Opening covers and projecting hardware also reserve space against unrelated
  // trains; the original 45 mm headroom is never reduced.
  const state = (train as TrainSnapshot & { noseCoupling?: NoseCouplingState }).noseCoupling
  if (state && (state.open > 0 || state.extension > 0)) poses.cars.forEach((pose, index) => {
    if (!pose || !(train.type === 'e5' && index === 0 || train.type === 'e6' && index === train.carCount - 1)) return
    const local = localBounds(index)
    volumes.push(offsetWorldVolume(pose, { ...local, bottom: Math.min(0, local.bottom), top: Math.max(45, local.top) }, index))
  })
  volumes.forEach(volume => merge(bounds, volume.bounds))
  const visibleCars = poses.cars.filter(Boolean).length
  const physicalCars = new Map<number, PhysicalBodyVolume[]>()
  const selfCollisionParts = (carIndex: number): PhysicalBodyVolume[] => {
    const cached = physicalCars.get(carIndex)
    if (cached) return cached
    const pose = poses.cars[carIndex]
    const parts = pose ? physicalLocalVolumes(train, carIndex).map(local => physicalWorldVolume(pose, local, carIndex, train)) : []
    physicalCars.set(carIndex, parts)
    return parts
  }
  const footprint = { volumes, bounds, complete: visibleCars === train.carCount, visibleCars, rearOffset: poses.rearOffset }
  let selfBounds: BodyVolume[] | undefined
  SELF_COLLISION_PARTS.set(footprint, {
    bounds: () => selfBounds ??= poses.cars.flatMap((pose, index) =>
      pose ? [offsetWorldVolume(pose, localBounds(index), index)] : []),
    parts: selfCollisionParts,
  })
  return footprint
}

export function trainFootprintsConflict(first: TrainFootprint, second: TrainFootprint, margin = TRAIN_SAFETY_GAP): boolean {
  return safetyBoundsIntersect(first.bounds, second.bounds, margin)
    && first.volumes.some(a => second.volumes.some(b => bodyVolumesIntersect(a, b, margin)))
}

/** Solid-car broad bounds are also available for geometry verification. */
export function trainSelfCollisionBounds(footprint: TrainFootprint): readonly BodyVolume[] {
  return SELF_COLLISION_PARTS.get(footprint)?.bounds() ?? footprint.volumes
}

export function trainFootprintOverlapsItself(footprint: TrainFootprint): boolean {
  const physicalParts = SELF_COLLISION_PARTS.get(footprint)
  const volumes = trainSelfCollisionBounds(footprint)
  return volumes.some((a, index) => volumes.slice(index + 1).some(b => {
    if (a.carIndex === b.carIndex || !bodyVolumesIntersect(a, b)) return false
    if (!physicalParts) return true
    const first = physicalParts.parts(a.carIndex), second = physicalParts.parts(b.carIndex)
    const mating = INTENTIONAL_NOSE_CONTACTS.get(footprint)?.some(([firstIndex, secondIndex]) => firstIndex === a.carIndex && secondIndex === b.carIndex || firstIndex === b.carIndex && secondIndex === a.carIndex)
    return first.some(physicalA => second.some(physicalB => !(mating && physicalA.matingHead && physicalB.matingHead)
      && bodyVolumesIntersect(physicalA, physicalB) && convexShapesIntersect(physicalA.vertices, physicalB.vertices)))
  }))
}

/** Keep global car identities while sharing the intentional mating-head contact. */
export function combineTrainFootprints(first: TrainFootprint, second: TrainFootprint, secondIndexOffset: number, matingPair?: readonly [number, number], rearOffset?: number): TrainFootprint {
  const bounds = emptyBounds(); merge(bounds, first.bounds); merge(bounds, second.bounds)
  const result: TrainFootprint = { volumes: [...first.volumes, ...second.volumes.map(volume => ({ ...volume, carIndex: volume.carIndex + secondIndexOffset }))],
    bounds, complete: first.complete && second.complete, visibleCars: first.visibleCars + second.visibleCars, rearOffset: rearOffset ?? first.rearOffset + second.rearOffset }
  const a = SELF_COLLISION_PARTS.get(first), b = SELF_COLLISION_PARTS.get(second)
  if (a && b) SELF_COLLISION_PARTS.set(result, {
    bounds: () => [...a.bounds(), ...b.bounds().map(volume => ({ ...volume, carIndex: volume.carIndex + secondIndexOffset }))],
    parts: index => index < secondIndexOffset ? a.parts(index) : b.parts(index - secondIndexOffset).map(volume => ({ ...volume, carIndex: index })),
  })
  if (matingPair) INTENTIONAL_NOSE_CONTACTS.set(result, [matingPair])
  return result
}

/** Actual shells, moving covers and arms must stay clear during docking. Only
 * the two designated mechanical mating heads may share their intended contact. */
export function physicalTrainFootprintsConflict(first: TrainFootprint, second: TrainFootprint, matingPair?: readonly [number, number]): boolean {
  const a = SELF_COLLISION_PARTS.get(first), b = SELF_COLLISION_PARTS.get(second)
  if (!a || !b) return trainFootprintsConflict(first, second, 0)
  return a.bounds().some(one => b.bounds().some(two => bodyVolumesIntersect(one, two) && a.parts(one.carIndex).some(partA => b.parts(two.carIndex).some(partB => {
    if (matingPair && one.carIndex === matingPair[0] && two.carIndex === matingPair[1] && partA.matingHead && partB.matingHead) return false
    return bodyVolumesIntersect(partA, partB) && convexShapesIntersect(partA.vertices, partB.vertices)
  }))))
}

function sweptVolumes(start: TrainFootprint, end: TrainFootprint, sharedTranslation: PoseVector): TrainFootprint {
  const bounds = emptyBounds()
  const volumes = start.volumes.map((before, index) => {
    const after = end.volumes[index]
    if (!after || after.carIndex !== before.carIndex) return before
    const centerChange = subtract(subtract(after.center, before.center), sharedTranslation)
    const rotation = before.axes.reduce((sum, axis, side) => sum + magnitude(subtract(after.axes[side], axis)) * before.half[side], 0)
    // Each outer integration substep advances at most 2 mm on the rails. A
    // generous chord/arc allowance also covers smooth body rotation at joins.
    const expansion = (magnitude(centerChange) + rotation) * 1.1 + .03
    const half = before.half.map(value => value + expansion) as BodyVolume['half']
    const volume = { ...before, half, bounds: boundsOf(before.center, before.axes, half) }
    merge(bounds, volume.bounds)
    return volume
  })
  return { ...start, volumes, bounds }
}

/** Conservative sweep in a shared translating frame avoids falsely stopping
 * two trains maintaining the same gap on a straight. End-only tests can tunnel.
 * This is a fail-safe broad volume, not a continuous rigid-body physics solver.
 */
export function sweptTrainFootprintsConflict(a: TrainFootprint, nextA: TrainFootprint, b: TrainFootprint, nextB: TrainFootprint): boolean {
  if (trainFootprintsConflict(nextA, nextB)) return true
  if (!a.volumes.length || !b.volumes.length) return false
  const translation = nextA.volumes[0] ? subtract(nextA.volumes[0].center, a.volumes[0].center) : { x: 0, y: 0, z: 0 }
  return trainFootprintsConflict(sweptVolumes(a, nextA, translation), sweptVolumes(b, nextB, translation))
}

/** Body ends can cover point blades before/after bogies enter a switch. */
export function bodyOccupiedTurnoutIds(tracks: Track[], footprints: readonly TrainFootprint[]): Set<string> {
  const occupied = new Set<string>()
  for (const track of tracks) {
    const shape = ITEMS.get(track.kind)?.shape
    if (shape !== 'turnout' && shape !== 'scissors') continue
    for (const route of pathsFor(track)) {
      const count = Math.ceil(route.length / 8)
      for (let index = 0; index <= count; index++) {
        const point = pointAt(track, route.length * index / count, route.route)
        const probe: BodyVolume = {
          carIndex: -1, center: { x: point.x, y: point.y, z: point.z + RAIL_TOP + 2 },
          axes: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }], half: [1, 1, 2],
          bounds: { minX: point.x - 1, maxX: point.x + 1, minY: point.y - 1, maxY: point.y + 1, minZ: point.z + RAIL_TOP, maxZ: point.z + RAIL_TOP + 4 },
        }
        if (footprints.some(footprint => safetyBoundsIntersect(footprint.bounds, probe.bounds) && footprint.volumes.some(volume => bodyVolumesIntersect(volume, probe)))) {
          occupied.add(track.id); break
        }
      }
      if (occupied.has(track.id)) break
    }
  }
  return occupied
}
