import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { makeCouplingDemo } from './couplingDemo'
import { restoreFleet } from './fleet'
import { solveConsistPoses } from './consistPose'
import { solveCoupledFormation } from './formationPose'
import { synchronizeCoupledFleet } from './couplingMotion'
import { makeKatoPlan02 } from './katoPlan'
import { createShinkansenCar } from './shinkansenModel'
import { disposeTrainModel } from './trainModel'
import { getNoseCouplerDiagnostics } from './noseCoupler'
import { physicalTrainFootprintsConflict, trainFootprintFromPoses, trainSelfCollisionBounds } from './trainSafety'

const MODELS = ['e5', 'e6', 'e7'] as const
const ENDS = ['front', 'rear'] as const
const INTERMEDIATE_OPENINGS = [.1, .25, .5, .75, .9]
const GRADE_POSITIONS = [
  ['kato-plan02-main-20', 80],
  ['kato-plan02-main-23', 160],
  ['kato-plan02-main-35', 100],
] as const

describe('rotating Shinkansen cover safety geometry', () => {
  for (const type of MODELS) for (const end of ENDS) {
    it(`${type} ${end} contains actual intermediate cap vertices on the curved grade`, () => {
      const tracks = makeKatoPlan02().tracks
      const original = restoreFleet(makeCouplingDemo())[0]
      const index = end === 'front' ? 0 : original.carCount - 1
      const axis = new THREE.Vector3(1, .08, -.16).normalize()
      let pitchedCabSeen = false
      for (const [trackId, distance] of GRADE_POSITIONS) for (const open of INTERMEDIATE_OPENINGS) {
        const train = { ...original, type, position: { trackId, distance, direction: 1 as const, laps: 0 },
          noseCoupling: { open, extension: 0, locked: false, end, axis: { x: axis.x, y: axis.y, z: axis.z } } }
        const poses = solveConsistPoses(tracks, train.position, train.cabForward, train.carCount, type)
        expect(poses.cars.every(Boolean)).toBe(true)
        const pose = poses.cars[index]!
        pitchedCabSeen ||= Math.abs(pose.pitch) > .001
        const footprint = trainFootprintFromPoses(train, poses)
        const solid = trainSelfCollisionBounds(footprint).find(volume => volume.carIndex === index)!
        const reserves = footprint.volumes.filter(volume => volume.carIndex === index)
        const car = createShinkansenCar(index, train.carCount, type, train.noseCoupling)
        // Independently reproduce the renderer's car pose, rather than deriving
        // rendered vertices from the safety volume being tested.
        const forward = new THREE.Vector3(pose.direction.x, pose.direction.z, pose.direction.y)
        const sideways = forward.clone().cross(new THREE.Vector3(0, 1, 0)).normalize()
        const up = sideways.clone().cross(forward).normalize()
        car.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(forward, up, sideways))
        car.position.set(pose.center.x, pose.center.z + 7.35, pose.center.y)
        car.updateMatrixWorld(true)
        const point = new THREE.Vector3()
        let vertices = 0, largestSolidExcess = -Infinity, largestReserveExcess = -Infinity
        const excess = (volume: typeof solid, x: number, y: number, z: number): number => Math.max(...volume.axes.map((direction, axisIndex) =>
          Math.abs((x - volume.center.x) * direction.x + (y - volume.center.y) * direction.y + (z - volume.center.z) * direction.z) - volume.half[axisIndex]))
        try {
          const diagnostics = getNoseCouplerDiagnostics(car)!
          expect(diagnostics.coverTransforms).toHaveLength(2)
          expect(diagnostics.coverTransforms.every(cover => Math.abs(cover.quaternion[1]) > 0)).toBe(true)
          for (const side of ['left', 'right']) car.getObjectByName(`nose-opening-cover-${side}`)!.traverse(object => {
            if (!(object instanceof THREE.Mesh)) return
            const positions = object.geometry.getAttribute('position')
            for (let vertex = 0; vertex < positions.count; vertex++) {
              point.fromBufferAttribute(positions, vertex).applyMatrix4(object.matrixWorld)
              vertices++
              // Three's world Y is elevation; the railway's world Z is elevation.
              largestSolidExcess = Math.max(largestSolidExcess, excess(solid, point.x, point.z, point.y))
              largestReserveExcess = Math.max(largestReserveExcess, Math.min(...reserves.map(volume => excess(volume, point.x, point.z, point.y))))
            }
          })
          const context = `${type} ${end} open=${open} ${trackId}`
          expect(vertices).toBeGreaterThan(100)
          expect(largestSolidExcess, `${context}: rotated cap exceeds physical collision bounds`).toBeLessThanOrEqual(1e-6)
          expect(largestReserveExcess, `${context}: rotated cap escapes unrelated-train reserves`).toBeLessThanOrEqual(1e-6)
        } finally { disposeTrainModel(car) }
      }
      expect(pitchedCabSeen, `${type} ${end} fixture must exercise a pitched cab`).toBe(true)
    }, 15000)
  }

  it.each(MODELS)('%s intermediate cap contact remains forbidden for the designated mating cabs', type => {
    const layout = makeCouplingDemo({ firstType: type, secondType: type })
    const fleet = restoreFleet(layout)
    const group = { id: 'cover-contact', e6Id: fleet[0].id, e5Id: fleet[1].id, e6End: 'rear' as const, e5End: 'front' as const }
    const members = synchronizeCoupledFleet(layout.tracks, fleet, [group])
    const poses = solveCoupledFormation(layout.tracks, members[0], members[1], group)
    const first = trainFootprintFromPoses({ ...members[0], noseCoupling: { ...members[0].noseCoupling!, open: .1 } }, poses.e6)
    const second = trainFootprintFromPoses({ ...members[1], noseCoupling: { ...members[1].noseCoupling!, open: .1 } }, poses.e5)
    expect(physicalTrainFootprintsConflict(first, second, [2, 0])).toBe(true)
  })
})
