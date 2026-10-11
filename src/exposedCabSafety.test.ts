import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { makeKatoPlan02 } from './katoPlan'
import { solveConsistPoses } from './consistPose'
import { createE235Car, disposeTrainModel } from './trainModel'
import { getNoseCouplerDiagnostics, updateNoseCoupler } from './noseCoupler'
import { trainFootprintFromPoses, trainSelfCollisionBounds } from './trainSafety'
import type { NoseCouplingState } from './couplingTypes'
import type { TrainSnapshot } from './fleet'

describe('exposed E235 cab fitting safety geometry', () => {
  it.each(['front', 'rear'] as const)('contains actual articulated %s head and shank vertices on a curved grade', end => {
    const { tracks } = makeKatoPlan02()
    const axis = new THREE.Vector3(1, .08, -.16).normalize()
    const state: NoseCouplingState = { open: 0, extension: 1, locked: true, end, axis: { x: axis.x, y: axis.y, z: axis.z } }
    const train: TrainSnapshot & { noseCoupling: NoseCouplingState } = {
      id: 'exposed-cab', name: 'Yamanote', type: 'e235', carCount: 3, requestedSpeed: 65, cabForward: true,
      position: { trackId: 'kato-plan02-main-20', distance: 100, direction: 1, laps: 0 }, noseCoupling: state,
    }
    const poses = solveConsistPoses(tracks, train.position!, train.cabForward, train.carCount, train.type)
    expect(poses.cars.every(Boolean)).toBe(true)
    const index = end === 'front' ? 0 : train.carCount - 1, pose = poses.cars[index]!
    const footprint = trainFootprintFromPoses(train, poses)
    const solid = trainSelfCollisionBounds(footprint).find(volume => volume.carIndex === index)!
    const reserves = footprint.volumes.filter(volume => volume.carIndex === index)
    const car = createE235Car(index, train.carCount)
    try {
      updateNoseCoupler(car, state)
      const forward = new THREE.Vector3(pose.direction.x, pose.direction.z, pose.direction.y)
      const sideways = forward.clone().cross(new THREE.Vector3(0, 1, 0)).normalize()
      const up = sideways.clone().cross(forward).normalize()
      car.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(forward, up, sideways))
      car.position.set(pose.center.x, pose.center.z + 7.35, pose.center.y)
      car.updateMatrixWorld(true)
      const excess = (volume: typeof solid, point: THREE.Vector3) => Math.max(...volume.axes.map((direction, axisIndex) =>
        Math.abs((point.x - volume.center.x) * direction.x + (point.z - volume.center.y) * direction.y + (point.y - volume.center.z) * direction.z) - volume.half[axisIndex]))
      for (const name of ['cab-mechanical-coupler-head', 'cab-mechanical-coupler-shank']) {
        const mesh = car.getObjectByName(name) as THREE.Mesh, vertices = mesh.geometry.getAttribute('position')
        for (let index = 0; index < vertices.count; index++) {
          const point = new THREE.Vector3().fromBufferAttribute(vertices, index).applyMatrix4(mesh.matrixWorld)
          expect(excess(solid, point), name).toBeLessThan(1e-6)
          expect(Math.min(...reserves.map(volume => excess(volume, point))), name).toBeLessThan(1e-6)
        }
      }
      expect(getNoseCouplerDiagnostics(car)!.coverTransforms).toEqual([])
      // The conservative independent-train space still includes the exposed
      // fitting when no operation or articulated state exists.
      const independent = trainFootprintFromPoses({ ...train, noseCoupling: undefined }, poses)
      expect(independent.volumes.filter(volume => volume.carIndex === index).length).toBeGreaterThan(1)
    } finally { disposeTrainModel(car) }
  })
})
