import { KATO_CATALOG } from './catalog'
import { solveConsistPoses } from './consistPose'
import type { CarPose, PoseVector } from './consistPose'
import type { TrainSnapshot } from './fleet'
import { shinkansenSurface } from './shinkansenModel'
import { pathsFor, pointAt } from './track'
import type { Track } from './track'
import { getTrainCarSpec } from './trains'

/** Clearance between independent sets. Coupling has no exemption in this release. */
export const TRAIN_SAFETY_GAP = 2
const RAIL_TOP = 7.35
const EPSILON = 1e-7
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
const NOSE_STATIONS = {
  e5: [0, .14, .27, .40, .59, .77, .91, 1],
  e6: [0, .13, .27, .44, .64, .82, .94, 1],
  e7: [0, .17, .35, .53, .72, .88, 1],
}

/** Separate tapered nose volumes follow the existing loft without editing it. */
function localVolumes(train: TrainSnapshot, index: number): LocalVolume[] {
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

export function trainFootprint(tracks: Track[], train: TrainSnapshot): TrainFootprint {
  const bounds = emptyBounds()
  if (!train.position) return { volumes: [], bounds, complete: false, visibleCars: 0, rearOffset: 0 }
  const poses = solveConsistPoses(tracks, train.position, train.cabForward, train.carCount, train.type)
  const volumes = poses.cars.flatMap((pose, index) => pose ? localVolumes(train, index).map(local => worldVolume(pose, local, index)) : [])
  volumes.forEach(volume => merge(bounds, volume.bounds))
  const visibleCars = poses.cars.filter(Boolean).length
  return { volumes, bounds, complete: visibleCars === train.carCount, visibleCars, rearOffset: poses.rearOffset }
}

export function trainFootprintsConflict(first: TrainFootprint, second: TrainFootprint, margin = TRAIN_SAFETY_GAP): boolean {
  return safetyBoundsIntersect(first.bounds, second.bounds, margin)
    && first.volumes.some(a => second.volumes.some(b => bodyVolumesIntersect(a, b, margin)))
}

export function trainFootprintOverlapsItself(footprint: TrainFootprint): boolean {
  return footprint.volumes.some((a, index) => footprint.volumes.slice(index + 1).some(b => a.carIndex !== b.carIndex && bodyVolumesIntersect(a, b)))
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
