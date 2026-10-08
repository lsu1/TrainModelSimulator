import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { solveConsistPoses } from './consistPose'
import { makeKatoPlan02 } from './katoPlan'
import { createTrainCar, disposeTrainModel } from './trainModel'
import { TRAIN_TYPES } from './trains'
import type { TrainSnapshot } from './fleet'
import { advanceTrain, attachTrack, endpoints, makeCityLayout } from './track'
import type { Track } from './track'
import { bodyVolumesIntersect, sweptTrainFootprintsConflict, trainFootprint, trainFootprintsConflict, trainFootprintOverlapsItself, trainSelfCollisionBounds } from './trainSafety'

const straight: Track = { id: 'straight', kind: 's248', x: 0, y: 0, angle: 0, bend: 1 }
const train = (trackId: string, distance: number, id = 'one', direction: 1 | -1 = 1): TrainSnapshot => ({
  id, name: id, type: 'e235', carCount: 3, requestedSpeed: 65, cabForward: true,
  position: { trackId, distance, direction, route: 0, laps: 0 },
})

describe('moving rolling-stock envelopes', () => {
  it('clears rounded cars at the former KATO grade stop while retaining independent-train headroom', () => {
    const { tracks } = makeKatoPlan02()
    const candidate = train('kato-plan02-main-20', 90)
    const footprint = trainFootprint(tracks, candidate)
    expect(footprint.complete).toBe(true)
    expect(bodyVolumesIntersect(footprint.volumes[0], footprint.volumes[1])).toBe(true)
    expect(trainFootprintOverlapsItself(footprint)).toBe(false)
    expect(footprint.volumes.every(volume => volume.half[2] === 22.5)).toBe(true)
    expect(trainFootprintsConflict(footprint, trainFootprint(tracks, { ...candidate, id: 'other' }))).toBe(true)
  })

  it('still detects real adjacent-car contact at an abrupt, steep grade', () => {
    const tracks: Track[] = Array.from({ length: 3 }, (_, index) => ({
      ...straight, id: `approach-${index}`, x: (index - 3) * 248,
    }))
    tracks.push({ ...straight, id: 'steep', endElevation: 100 })
    const overlaps = Array.from({ length: 31 }, (_, index) =>
      trainFootprintOverlapsItself(trainFootprint(tracks, train('steep', index * 5))))
    expect(overlaps.some(Boolean)).toBe(true)
  })

  it.each(TRAIN_TYPES)('contains every retained %s shell, nose and end fitting in the self-contact broad phase', type => {
    const { tracks } = makeKatoPlan02()
    const candidate = { ...train('kato-plan02-main-20', 100), type }
    const poses = solveConsistPoses(tracks, candidate.position!, true, 3, type)
    const volumes = trainSelfCollisionBounds(trainFootprint(tracks, candidate))
    expect(volumes).toHaveLength(3)
    for (const volume of volumes) {
      const pose = poses.cars[volume.carIndex]!
      const car = createTrainCar(volume.carIndex, 3, type)
      car.updateMatrixWorld(true)
      const point = new THREE.Vector3(), transform = new THREE.Matrix4(), instanceMatrix = new THREE.Matrix4()
      const worldBounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity }
      const maxProjection = [0, 0, 0]
      car.traverse(object => {
        if (!(object instanceof THREE.Mesh) || /^(?:covered-)?coupler-mount-(?:front|rear)$/.test(object.name)) return
        const positions = object.geometry.getAttribute('position')
        if (!positions) return
        const instances = object instanceof THREE.InstancedMesh ? object.count : 1
        for (let instance = 0; instance < instances; instance++) {
          transform.copy(object.matrixWorld)
          if (object instanceof THREE.InstancedMesh) {
            object.getMatrixAt(instance, instanceMatrix); transform.multiply(instanceMatrix)
          }
          for (let vertex = 0; vertex < positions.count; vertex++) {
            point.fromBufferAttribute(positions, vertex).applyMatrix4(transform)
            // Renderer X is forward, Y is up and Z is lateral.
            const [forward, right, up] = volume.axes
            const x = pose.center.x + forward.x * point.x + right.x * point.z + up.x * point.y
            const y = pose.center.y + forward.y * point.x + right.y * point.z + up.y * point.y
            const z = pose.center.z + 7.35 + forward.z * point.x + up.z * point.y
            worldBounds.minX = Math.min(worldBounds.minX, x); worldBounds.maxX = Math.max(worldBounds.maxX, x)
            worldBounds.minY = Math.min(worldBounds.minY, y); worldBounds.maxY = Math.max(worldBounds.maxY, y)
            worldBounds.minZ = Math.min(worldBounds.minZ, z); worldBounds.maxZ = Math.max(worldBounds.maxZ, z)
            volume.axes.forEach((axis, index) => {
              const projected = Math.abs((x - volume.center.x) * axis.x + (y - volume.center.y) * axis.y + (z - volume.center.z) * axis.z)
              maxProjection[index] = Math.max(maxProjection[index], projected)
            })
          }
        }
      })
      disposeTrainModel(car)
      expect(worldBounds.minX).toBeGreaterThanOrEqual(volume.bounds.minX - 1e-6)
      expect(worldBounds.minY).toBeGreaterThanOrEqual(volume.bounds.minY - 1e-6)
      expect(worldBounds.minZ).toBeGreaterThanOrEqual(volume.bounds.minZ - 1e-6)
      expect(worldBounds.maxX).toBeLessThanOrEqual(volume.bounds.maxX + 1e-6)
      expect(worldBounds.maxY).toBeLessThanOrEqual(volume.bounds.maxY + 1e-6)
      expect(worldBounds.maxZ).toBeLessThanOrEqual(volume.bounds.maxZ + 1e-6)
      maxProjection.forEach((projected, index) => expect(projected).toBeLessThanOrEqual(volume.half[index] + 1e-6))
    }
  })

  it('detects real body ends beyond bogies, with grade and height separation', () => {
    const a = trainFootprint([straight], train('straight', 200))
    const b = trainFootprint([{ ...straight, id: 'other', y: 18 }], train('other', 200, 'two'))
    expect(trainFootprintsConflict(a, b)).toBe(true)
    const raised = { ...straight, id: 'raised', elevation: 60 }
    expect(trainFootprintsConflict(a, trainFootprint([raised], train('raised', 200, 'raised')))).toBe(false)
    const ramp = { ...straight, id: 'ramp', endElevation: 8 }
    const grade = trainFootprint([ramp], train('ramp', 200))
    expect(grade.volumes[0].axes[0].z).toBeGreaterThan(0)
    expect(grade.volumes[0].bounds.maxZ).toBeGreaterThan(a.volumes[0].bounds.maxZ)
    const body = a.volumes[0]
    const noseOnly = { ...body, center: { ...body.center, x: body.center.x + 130 }, bounds: { ...body.bounds, minX: body.bounds.minX + 130, maxX: body.bounds.maxX + 130 } }
    expect(bodyVolumesIntersect(body, noseOnly)).toBe(true)
  })

  it('catches swept head-on contact while preserving equal-speed following gaps', () => {
    const tracks: Track[] = []
    let anchor = { position: { x: -1240, y: 0, z: 0 }, angle: 0 }
    for (let index = 0; index < 10; index++) {
      const track = attachTrack('s248', 1, anchor, `line-${index}`); tracks.push(track)
      const end = endpoints(track)[1]; anchor = { ...end, position: { ...end.position, z: 0 } }
    }
    const left = train(tracks[5].id, 100), right = train(tracks[5].id, 105, 'two', -1)
    const next = (value: TrainSnapshot, distance: number) => ({ ...value, position: advanceTrain(tracks, value.position!, distance).position })
    expect(trainFootprintsConflict(trainFootprint(tracks, left), trainFootprint(tracks, right))).toBe(false)
    expect(sweptTrainFootprintsConflict(trainFootprint(tracks, left), trainFootprint(tracks, next(left, 2)), trainFootprint(tracks, right), trainFootprint(tracks, next(right, 2)))).toBe(true)
    const follower = train(tracks[5].id, 50), leader = train(tracks[7].id, 0, 'leader')
    expect(sweptTrainFootprintsConflict(trainFootprint(tracks, follower), trainFootprint(tracks, next(follower, 2)), trainFootprint(tracks, leader), trainFootprint(tracks, next(leader, 2)))).toBe(false)
  })

  it('uses train-specific tapered noses and preserves exact poses on reversal', () => {
    const tracks = makeCityLayout()
    for (const type of ['e235', 'e5', 'e6', 'e7'] as const) {
      const original = { ...train(tracks[3].id, 200), type }
      const footprint = trainFootprint(tracks, original)
      expect(footprint.complete).toBe(true)
      const reverse = { ...original, cabForward: false, position: { ...original.position!, direction: -1 as const } }
      expect(trainFootprint(tracks, reverse)).toEqual(footprint)
      if (type !== 'e235') {
        const nose = footprint.volumes.filter(volume => volume.carIndex === 0)
        expect(nose).toHaveLength(type === 'e7' ? 7 : 8)
        expect(nose[nose.length - 1].half[1]).toBeLessThan(nose[0].half[1])
      }
    }
  })
})
