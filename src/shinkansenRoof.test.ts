import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { addShinkansenRoof, getShinkansenRoofConfiguration } from './shinkansenRoof'
import { getTrainCarSpec } from './trains'
import { disposeTrainModel } from './trainModel'

const types = ['e5', 'e6', 'e7'] as const
function materials() {
  return {
    primary: new THREE.MeshStandardMaterial({ color: '#176e80' }),
    pearl: new THREE.MeshStandardMaterial({ color: '#eeeeea' }),
    silver: new THREE.MeshStandardMaterial({ color: '#adb5bb' }),
    dark: new THREE.MeshStandardMaterial({ color: '#313a40' }),
  }
}
function equipment(type: typeof types[number], index: number, total: number) {
  const parent = new THREE.Group(), spec = getTrainCarSpec(type, index, total)
  const roof = addShinkansenRoof(parent, spec, type, index, total, materials())
  parent.updateMatrixWorld(true)
  return { parent, spec, roof }
}

describe('reference-based Shinkansen roof equipment', () => {
  it.each([
    ['e5', 10, [7, 3], [3, 7]],
    ['e6', 7, [16, 12], [1, 5]],
    ['e7', 12, [7, 3], [5, 9]],
  ] as const)('%s authentic formation locates both collectors on the official numbered cars', (type, total, numbers, indices) => {
    const configuration = Array.from({ length: total }, (_, i) => getShinkansenRoofConfiguration(type, i, total))
    expect(configuration.filter(car => car.pantograph).map(car => car.prototypeRoofCarNumber)).toEqual(numbers)
    expect(configuration.flatMap((car, i) => car.pantograph ? [i] : [])).toEqual(indices)
    expect(configuration.every(car => car.prototypeFormation)).toBe(true)
    expect(configuration.filter(car => car.pantograph).map(car => car.pantographDirection)).toEqual([1, -1])
  })

  it.each(types)('%s play counts preserve outward cab roles and sensible interior collectors', type => {
    for (let total = 3; total <= 11; total++) {
      const configuration = Array.from({ length: total }, (_, i) => getShinkansenRoofConfiguration(type, i, total))
      expect(configuration[0].roofRole).toBe('cab')
      expect(configuration.at(-1)?.roofRole).toBe('cab')
      expect(configuration.filter(car => car.roofRole === 'cab')).toHaveLength(2)
      expect(configuration.filter(car => car.pantograph)).toHaveLength(total === 3 ? 1 : 2)
      expect(configuration.filter(car => car.pantograph).every(car => car.antennaStyle === null)).toBe(true)
    }
  })

  it.each(types)('%s both cab antenna fittings remain on the full-height roof and mirror with the exterior', type => {
    const front = equipment(type, 0, 3), rear = equipment(type, 2, 3)
    rear.parent.rotation.y = Math.PI
    rear.parent.updateMatrixWorld(true)
    const frontAntenna = front.roof.getObjectByName('cab-radio-antenna')!
    const rearAntenna = rear.roof.getObjectByName('cab-radio-antenna')!
    const first = frontAntenna.getWorldPosition(new THREE.Vector3()), last = rearAntenna.getWorldPosition(new THREE.Vector3())
    expect(first.x).toBeLessThan(front.spec.length / 2 - front.spec.noseLength)
    expect(first.y).toBeGreaterThan(front.spec.height)
    expect(last.x).toBeCloseTo(-first.x, 6)
    expect(last.y).toBeCloseTo(first.y, 6)
    expect(front.roof.getObjectByName('single-arm-pantograph')).toBeUndefined()
    expect(rear.roof.getObjectByName('single-arm-pantograph')).toBeUndefined()
    expect(frontAntenna.getObjectByName('streamlined-radio-blade')).toBeDefined()
    disposeTrainModel(front.parent); disposeTrainModel(rear.parent)
  })

  it.each(types)('%s new mesh geometry stays finite, inside each body end and below reserved clearance height', type => {
    for (const total of [3, 7, 10, 11]) for (let index = 0; index < total; index++) {
      const { parent, roof, spec } = equipment(type, index, total)
      const box = new THREE.Box3().setFromObject(roof)
      expect(box.min.x).toBeGreaterThan(-spec.length / 2)
      expect(box.max.x).toBeLessThan(spec.length / 2 - spec.noseLength)
      expect(box.max.y).toBeLessThan(45)
      expect(box.min.z).toBeGreaterThan(-spec.width / 2)
      expect(box.max.z).toBeLessThan(spec.width / 2)
      expect(roof.getObjectByName('roof-service-panel-seams')).toBeDefined()
      expect(roof.getObjectByName('flush-roof-ventilation-grilles')).toBeDefined()
      parent.traverse(object => {
        if (!(object instanceof THREE.Mesh || object instanceof THREE.Line)) return
        for (const attribute of Object.values(object.geometry.attributes) as THREE.BufferAttribute[]) expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true)
      })
      disposeTrainModel(parent)
    }
  })

  it.each(types)('%s collector has joined articulated arms, insulated bases and a real elevated contact attachment', type => {
    const { parent, roof, spec } = equipment(type, 1, 3)
    const collector = roof.getObjectByName('single-arm-pantograph')!
    expect(collector.getObjectByName('pantograph-lower-arm')).toBeDefined()
    expect(collector.children.filter(child => child.name === 'pantograph-upper-arm')).toHaveLength(2)
    expect(collector.children.filter(child => child.name === 'pantograph-hinge')).toHaveLength(3)
    expect(roof.getObjectByName('pantograph-insulators')).toBeDefined()
    expect(roof.getObjectByName('high-voltage-insulators')).toBeDefined()
    const contact = collector.getObjectByName('pantograph-contact-strip')!
    const position = contact.getWorldPosition(new THREE.Vector3())
    expect(position.y).toBeGreaterThan(spec.height + 7)
    expect(position.y).toBeLessThan(spec.height + 9)
    expect(contact.getObjectByName('carbon-contact-strip')).toBeDefined()
    expect(roof.getObjectByName('low-streamlined-roof-equipment')).toBeUndefined()
    disposeTrainModel(parent)
  })

  it('E5 shields are taller than the compact E6 and E7 local fairings', () => {
    const heights = types.map(type => {
      const { parent, roof } = equipment(type, 1, 3)
      const name = type === 'e5' ? 'e5-tall-pantograph-noise-shields' : type === 'e6' ? 'e6-low-pantograph-ramp-fairings' : 'e7-compact-pantograph-fairings'
      const height = new THREE.Box3().setFromObject(roof.getObjectByName(name)!).getSize(new THREE.Vector3()).y
      disposeTrainModel(parent)
      return height
    })
    expect(heights[0]).toBeGreaterThan(heights[1] + 1.5)
    expect(heights[0]).toBeGreaterThan(heights[2] + 1.5)
  })

  it('new linework and raised antenna geometry are released with their car', () => {
    const { parent, roof } = equipment('e7', 0, 3)
    const seams = roof.getObjectByName('roof-service-panel-seams') as THREE.Line
    const antenna = roof.getObjectByName('streamlined-radio-blade') as THREE.Mesh
    const seamGeometry = vi.spyOn(seams.geometry, 'dispose'), antennaGeometry = vi.spyOn(antenna.geometry, 'dispose')
    const seamMaterial = vi.spyOn(seams.material as THREE.Material, 'dispose')
    disposeTrainModel(parent)
    expect(seamGeometry).toHaveBeenCalledOnce()
    expect(antennaGeometry).toHaveBeenCalledOnce()
    expect(seamMaterial).toHaveBeenCalledOnce()
  })
})
