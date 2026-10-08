import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { makeCouplingDemo } from './couplingDemo'
import { makeKatoPlan02 } from './katoPlan'
import { restoreFleet } from './fleet'
import { solveCoupledFormation } from './formationPose'
import { synchronizeCoupledFleet } from './couplingMotion'
import { combineTrainFootprints, physicalTrainFootprintsConflict, trainFootprintFromPoses, trainFootprintOverlapsItself, trainFootprintsConflict, trainSelfCollisionBounds } from './trainSafety'
import { advanceTrain } from './track'
import { createShinkansenCar } from './shinkansenModel'
import { disposeTrainModel } from './trainModel'

function joined(offset = 0) {
  const layout = makeCouplingDemo(), fleet = restoreFleet(layout), group = { id: 'pair', e6Id: fleet[0].id, e5Id: fleet[1].id }
  fleet[0].position = advanceTrain(layout.tracks, fleet[0].position!, offset).position
  const members = synchronizeCoupledFleet(layout.tracks, fleet, [group]), solved = solveCoupledFormation(layout.tracks, members[0], members[1])
  const first = trainFootprintFromPoses(members[0], solved.e6), second = trainFootprintFromPoses(members[1], solved.e5)
  return { layout, members, solved, first, second }
}

describe('actual moving nose-cover collision geometry', () => {
  it('has globally unique cars in the composite group while intentional mating contact stays clear', () => {
    const { members, solved, first, second } = joined()
    const formation = combineTrainFootprints(first, second, members[0].carCount, [members[0].carCount - 1, members[0].carCount], solved.rearOffset)
    expect(new Set(formation.volumes.map(volume => volume.carIndex)).size).toBe(6)
    expect(formation.visibleCars).toBe(6)
    expect(formation.complete).toBe(true)
    expect(trainFootprintOverlapsItself(formation)).toBe(false)
    expect(physicalTrainFootprintsConflict(first, second, [2, 0])).toBe(false)
    // Independent trains still reserve the original complete nose clearance;
    // this overlap only becomes a safe physical formation after an actual join.
    expect(trainFootprintsConflict(first, second)).toBe(true)
  })

  it('does not exempt closed cap/body contact when the same designated noses overlap', () => {
    const { members, solved } = joined()
    const closed = { open: 0, extension: 0, locked: false }
    const first = trainFootprintFromPoses({ ...members[0], noseCoupling: closed }, solved.e6)
    const second = trainFootprintFromPoses({ ...members[1], noseCoupling: closed }, solved.e5)
    expect(physicalTrainFootprintsConflict(first, second, [2, 0])).toBe(true)
    expect(trainFootprintOverlapsItself(combineTrainFootprints(first, second, 3, [2, 3]))).toBe(true)
  })

  it('uses animated geometry at the same train position rather than retaining the cached closed nose', () => {
    const { members, solved } = joined()
    const second = trainFootprintFromPoses(members[1], solved.e5)
    const closed = trainFootprintFromPoses({ ...members[0], noseCoupling: { open: 0, extension: 0, locked: false } }, solved.e6)
    const open = trainFootprintFromPoses(members[0], solved.e6)
    expect(physicalTrainFootprintsConflict(closed, second, [2, 0])).toBe(true)
    expect(physicalTrainFootprintsConflict(open, second, [2, 0])).toBe(false)
  })

  it.each([300, 450, 700, 900])('keeps articulated mechanical arms and real curved cab geometry clear at rail offset %s', offset => {
    const { members, solved, first, second } = joined(offset)
    expect(solved.complete).toBe(true)
    expect(members.every(train => train.noseCoupling?.axis)).toBe(true)
    expect(physicalTrainFootprintsConflict(first, second, [2, 0])).toBe(false)
    expect(trainFootprintOverlapsItself(combineTrainFootprints(first, second, 3, [2, 3]))).toBe(false)
  })

  it.each([
    ['kato-plan02-main-20', 80],
    ['kato-plan02-main-23', 160],
    ['kato-plan02-main-35', 100],
  ] as const)('contains every rendered coupling-cab vertex through the curved grade at %s:%s', (trackId, distance) => {
    const tracks = makeKatoPlan02().tracks, original = restoreFleet(makeCouplingDemo())
    const group = { id: 'grade-containment', e6Id: original[0].id, e5Id: original[1].id }
    original[0] = { ...original[0], position: { trackId, distance, direction: 1, laps: 0 } }
    const members = synchronizeCoupledFleet(tracks, original, [group])
    const solved = solveCoupledFormation(tracks, members[0], members[1])
    expect(solved.complete).toBe(true)
    const cabs = [
      { train: members[0], poses: solved.e6, index: members[0].carCount - 1 },
      { train: members[1], poses: solved.e5, index: 0 },
    ]
    expect(cabs.some(({ poses, index }) => Math.abs(poses.cars[index]!.pitch) > .001)).toBe(true)
    expect(cabs.some(({ train }) => Math.hypot(train.noseCoupling!.axis!.y, train.noseCoupling!.axis!.z) > .005)).toBe(true)
    for (const { train, poses, index } of cabs) {
      const pose = poses.cars[index]!, footprint = trainFootprintFromPoses(train, poses)
      const solid = trainSelfCollisionBounds(footprint).find(volume => volume.carIndex === index)!
      const reserves = footprint.volumes.filter(volume => volume.carIndex === index)
      const car = createShinkansenCar(index, train.carCount, train.type as 'e5' | 'e6', train.noseCoupling)
      // Apply the renderer's world transform independently of the safety box.
      const forward = new THREE.Vector3(pose.direction.x, pose.direction.z, pose.direction.y)
      const sideways = forward.clone().cross(new THREE.Vector3(0, 1, 0)).normalize()
      const up = sideways.clone().cross(forward).normalize()
      car.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(forward, up, sideways))
      car.position.set(pose.center.x, pose.center.z + 7.35, pose.center.y)
      car.updateMatrixWorld(true)
      const point = new THREE.Vector3(), instanceMatrix = new THREE.Matrix4(), transform = new THREE.Matrix4()
      let vertices = 0, instancedVertices = 0, largestSolidExcess = -Infinity, largestReserveExcess = -Infinity
      const excess = (volume: typeof solid, x: number, y: number, z: number): number => Math.max(...volume.axes.map((axis, axisIndex) =>
        Math.abs((x - volume.center.x) * axis.x + (y - volume.center.y) * axis.y + (z - volume.center.z) * axis.z) - volume.half[axisIndex]))
      try {
        car.traverse(object => {
          if (!(object instanceof THREE.Mesh) || /^(?:covered-)?coupler-mount-(?:front|rear)$/.test(object.name)) return
          for (let ancestor: THREE.Object3D | null = object; ancestor; ancestor = ancestor.parent) if (!ancestor.visible) return
          const positions = object.geometry.getAttribute('position')
          if (!positions) return
          const instances = object instanceof THREE.InstancedMesh ? object.count : 1
          for (let instance = 0; instance < instances; instance++) {
            transform.copy(object.matrixWorld)
            if (object instanceof THREE.InstancedMesh) { object.getMatrixAt(instance, instanceMatrix); transform.multiply(instanceMatrix) }
            for (let vertex = 0; vertex < positions.count; vertex++) {
              point.fromBufferAttribute(positions, vertex).applyMatrix4(transform)
              vertices++
              if (object instanceof THREE.InstancedMesh) instancedVertices++
              // Render world Y is elevation; layout world Z is elevation.
              largestSolidExcess = Math.max(largestSolidExcess, excess(solid, point.x, point.z, point.y))
              largestReserveExcess = Math.max(largestReserveExcess, Math.min(...reserves.map(volume => excess(volume, point.x, point.z, point.y))))
            }
          }
        })
        expect(vertices).toBeGreaterThan(100)
        expect(instancedVertices).toBeGreaterThan(0)
        expect(largestSolidExcess, `${train.type} actual mesh exceeds its self-contact box`).toBeLessThanOrEqual(1e-6)
        expect(largestReserveExcess, `${train.type} actual mesh exceeds every third-train reserve`).toBeLessThanOrEqual(1e-6)
      } finally { disposeTrainModel(car) }
    }
  })
})
