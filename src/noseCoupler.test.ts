import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { NOSE_COUPLER_PROFILES } from './couplingTypes'
import { createShinkansenCar, shinkansenSurface } from './shinkansenModel'
import { disposeTrainModel } from './trainModel'
import { getTrainCarSpec } from './trains'
import { getNoseCouplerDiagnostics, isMechanicalNoseCouplerContact, isNoseCouplingCar, orientNoseCoupler, updateNoseCoupler } from './noseCoupler'

const types = ['e5', 'e6'] as const
const surfaces = ['continuous-rounded-body-and-sculpted-nose', 'rounded-silver-nose-chin-and-coupler-cover']

function area(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute('position'), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
  const count = geometry.index?.count ?? position.count
  let sum = 0
  for (let offset = 0; offset < count; offset += 3) {
    const vertex = (i: number, target: THREE.Vector3) => target.fromBufferAttribute(position, geometry.index ? geometry.index.getX(i) : i)
    vertex(offset, a); vertex(offset + 1, b); vertex(offset + 2, c)
    sum += b.sub(a).cross(c.sub(a)).length() / 2
  }
  return sum
}

describe('E514 and E611 retained nose mechanisms', () => {
  it('uses only the correct physical cab roles in shortened and authentic sets', () => {
    for (const total of [3, 7, 10, 11]) {
      expect(isNoseCouplingCar('e5', 0, total)).toBe(true)
      expect(isNoseCouplingCar('e5', total - 1, total)).toBe(false)
      expect(isNoseCouplingCar('e6', total - 1, total)).toBe(true)
      expect(isNoseCouplingCar('e6', 0, total)).toBe(false)
      expect(isNoseCouplingCar('e7', 0, total)).toBe(false)
      expect(isNoseCouplingCar('e235', total - 1, total)).toBe(false)
    }
  })

  it.each(types)('%s closed cap preserves all original shell and paint triangle area and materials', type => {
    const index = type === 'e5' ? 0 : 2
    const closed = createShinkansenCar(index, 3, type), original = createShinkansenCar(2 - index, 3, type)
    const names = [...surfaces, type === 'e5' ? 'emerald-green-upper-body-and-duckbill' : 'carmine-red-roof-and-pointed-nose', ...(type === 'e5' ? ['pink-belt-line'] : [])]
    for (const name of names) {
      const originalMeshes: THREE.Mesh[] = [], fragments: THREE.Mesh[] = []
      original.traverse(object => { if (object instanceof THREE.Mesh && object.name === name) originalMeshes.push(object) })
      closed.traverse(object => { if (object instanceof THREE.Mesh && (object.name === name || object.userData.sourceSurface === name)) fragments.push(object) })
      const expected = originalMeshes.reduce((sum, mesh) => sum + area(mesh.geometry), 0)
      const actual = fragments.reduce((sum, mesh) => sum + area(mesh.geometry), 0)
      expect(Math.abs(actual - expected) / expected, name).toBeLessThan(.000002)
      const stationary = fragments.find(mesh => mesh.name === name)!
      for (const fragment of fragments) expect(fragment.material).toBe(stationary.material)
    }
    expect(getNoseCouplerDiagnostics(closed)?.coverTransforms.every(transform => transform.position.every(value => value === 0))).toBe(true)
    disposeTrainModel(closed); disposeTrainModel(original)
  })

  it.each(types)('%s opens and closes retained rigid panels without scaling, fading, or replacing geometry', type => {
    const car = createShinkansenCar(type === 'e5' ? 0 : 2, 3, type)
    const covers = ['left', 'right'].map(side => car.getObjectByName(`nose-opening-cover-${side}`)!)
    const geometries: THREE.BufferGeometry[] = []
    covers.forEach(cover => cover.traverse(object => { if (object instanceof THREE.Mesh) geometries.push(object.geometry) }))
    const children = covers.map(cover => [...cover.children])
    for (let step = 0; step <= 40; step++) {
      updateNoseCoupler(car, { open: step / 40, extension: Math.max(0, step / 40 - .8) * 5, locked: false })
      covers.forEach((cover, index) => {
        expect(cover.visible).toBe(true)
        expect(cover.scale.toArray()).toEqual([1, 1, 1])
        expect(cover.children).toEqual(children[index])
        cover.traverse(object => {
          expect(object.visible).toBe(true)
          expect(object.scale.toArray()).toEqual([1, 1, 1])
          if (object instanceof THREE.Mesh) expect(geometries).toContain(object.geometry)
        })
      })
    }
    const open = getNoseCouplerDiagnostics(car)!
    expect(open.coverTransforms[0].position[0]).toBeLessThan(-NOSE_COUPLER_PROFILES[type].cutBack)
    expect(open.coverTransforms[0].position[2]).toBeLessThan(-.8)
    expect(open.coverTransforms[1].position[2]).toBeGreaterThan(.8)
    updateNoseCoupler(car, { open: 0, extension: 0, locked: false })
    expect(getNoseCouplerDiagnostics(car)!.coverTransforms.every(transform => transform.position.every(value => value === 0))).toBe(true)
    disposeTrainModel(car)
  })

  it.each(types)('%s stows the complete painted cap inside its retained shell', type => {
    const index = type === 'e5' ? 0 : 2, spec = getTrainCarSpec(type, index, 3)
    const car = createShinkansenCar(index, 3, type, { open: 1, extension: 1, locked: false })
    for (const side of ['left', 'right']) {
      const cover = car.getObjectByName(`nose-opening-cover-${side}`)!
      cover.traverse(object => {
        if (!(object instanceof THREE.Mesh) || object.userData.noseCouplingPart !== 'cover') return
        const positions = object.geometry.getAttribute('position')
        for (let i = 0; i < positions.count; i++) {
          const point = new THREE.Vector3().fromBufferAttribute(positions, i).add(cover.position)
          const top = shinkansenSurface(spec, type, point.x, Math.PI / 2).y
          const bottom = shinkansenSurface(spec, type, point.x, -Math.PI / 2).y
          expect(point.y).toBeLessThan(top)
          expect(point.y).toBeGreaterThan(bottom)
          const unit = (point.y - (top + bottom) / 2) / ((top - bottom) / 2)
          const theta = Math.asin(Math.sign(unit) * Math.abs(unit) ** (1 / .67))
          const halfWidth = shinkansenSurface(spec, type, point.x, theta).z
          expect(Math.abs(point.z)).toBeLessThan(halfWidth)
        }
      })
    }
    disposeTrainModel(car)
  })

  it.each(types)('%s exposes the contractual mount and extended face on the physical cab end', type => {
    const index = type === 'e5' ? 0 : 2, sign = type === 'e5' ? 1 : -1
    const spec = getTrainCarSpec(type, index, 3), profile = NOSE_COUPLER_PROFILES[type]
    const car = createShinkansenCar(index, 3, type, { open: 1, extension: 1, locked: true })
    const diagnostic = getNoseCouplerDiagnostics(car)!
    expect(diagnostic.pivot.x).toBeCloseTo(sign * (spec.length / 2 - profile.mountInset), 7)
    expect(diagnostic.pivot.y).toBe(profile.height)
    expect(diagnostic.matingFace.x).toBeCloseTo(sign * (spec.length / 2 - profile.mountInset + profile.extensionLength), 7)
    expect(diagnostic.pivot.distanceTo(diagnostic.matingFace)).toBeCloseTo(profile.extensionLength, 7)
    const contact: THREE.Object3D[] = []
    car.traverse(object => { if (isMechanicalNoseCouplerContact(object)) contact.push(object) })
    expect(contact).toHaveLength(1)
    expect(contact[0].name).toBe('nose-mechanical-coupler-head')
    expect(contact[0].userData.locked).toBe(true)
    disposeTrainModel(car)
  })

  it.each(types)('%s articulates its rigid arm at fixed length and reports actual transformed anchors', type => {
    const car = createShinkansenCar(type === 'e5' ? 0 : 2, 3, type, { open: 1, extension: 1, locked: true })
    const baseline = getNoseCouplerDiagnostics(car)!, length = NOSE_COUPLER_PROFILES[type].extensionLength
    const direction = new THREE.Vector3(type === 'e5' ? 1 : -1, .04, .18).normalize()
    const target = baseline.pivot.clone().addScaledVector(direction, length)
    expect(orientNoseCoupler(car, target)).toBe(true)
    expect(getNoseCouplerDiagnostics(car)!.matingFace.distanceTo(target)).toBeLessThan(1e-7)
    expect(getNoseCouplerDiagnostics(car)!.pivot.distanceTo(getNoseCouplerDiagnostics(car)!.matingFace)).toBeCloseTo(length, 7)
    expect(getNoseCouplerDiagnostics(car)!.coverTransforms).toEqual(baseline.coverTransforms)
    const axis = new THREE.Vector3(1, .08, -.16).normalize()
    updateNoseCoupler(car, { open: 1, extension: 1, locked: true, axis: { x: axis.x, y: axis.y, z: axis.z } })
    const actual = getNoseCouplerDiagnostics(car)!
    const exteriorAxis = type === 'e5' ? axis : new THREE.Vector3(-axis.x, axis.y, -axis.z)
    expect(actual.matingFace.distanceTo(actual.pivot.clone().addScaledVector(exteriorAxis, length))).toBeLessThan(1e-7)
    disposeTrainModel(car)
  })

  it('preserves E7 and the unsupported E5/E6 ends without a mechanism', () => {
    for (const [type, index] of [['e7', 0], ['e5', 2], ['e6', 0]] as const) {
      const car = createShinkansenCar(index, 3, type, { open: 1, extension: 1, locked: true })
      expect(getNoseCouplerDiagnostics(car)).toBeNull()
      expect(updateNoseCoupler(car, { open: 1, extension: 1, locked: true })).toBe(false)
      expect(car.getObjectByName('nose-coupler-pivot')).toBeUndefined()
      disposeTrainModel(car)
    }
  })

  it('disposes retained inner panels, cavity walls and mechanical materials once', () => {
    const car = createShinkansenCar(0, 3, 'e5'), geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>()
    car.traverse(object => {
      if (!(object instanceof THREE.Mesh) || !object.userData.noseCouplingPart) return
      geometries.add(object.geometry)
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material)
    })
    const spies = [...geometries, ...materials].map(resource => vi.spyOn(resource, 'dispose'))
    disposeTrainModel(car)
    spies.forEach(spy => expect(spy).toHaveBeenCalledOnce())
  })
})
