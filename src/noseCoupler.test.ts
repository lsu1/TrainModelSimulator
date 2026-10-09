import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { NOSE_COUPLER_PROFILES } from './couplingTypes'
import { createShinkansenCar, shinkansenSurface } from './shinkansenModel'
import { disposeTrainModel } from './trainModel'
import { getTrainCarSpec } from './trains'
import { getNoseCouplerDiagnostics, isMechanicalNoseCouplerContact, isNoseCouplingCar, orientNoseCoupler, updateNoseCoupler } from './noseCoupler'

const types = ['e5', 'e6', 'e7'] as const
const cabs = types.flatMap(type => ['front', 'rear'].map(end => ({ type, end: end as 'front' | 'rear', index: end === 'front' ? 0 : 2, sign: end === 'front' ? 1 : -1 })))
// Triangle areas of the uncut v0.8.0 cab surfaces. These independently detect
// lost paint or shell triangles when either end is partitioned into covers.
const ORIGINAL_SURFACE_AREAS = {
  e5: { 'curved-nose-bogie-upper-fairing': 146.07376911588312, 'continuous-rounded-body-and-sculpted-nose': 9795.910180449084, 'emerald-green-upper-body-and-duckbill': 5409.846884527882, 'rounded-silver-nose-chin-and-coupler-cover': 1651.2173262676556, 'pink-belt-line': 149.4876403825713 },
  e6: { 'curved-nose-bogie-upper-fairing': 153.78301876831492, 'continuous-rounded-body-and-sculpted-nose': 7447.338528317663, 'carmine-red-roof-and-pointed-nose': 2414.7748584018304, 'rounded-silver-nose-chin-and-coupler-cover': 1181.3406406007214, 'silver-side-belt-below-windows': 179.00044151166588 },
  e7: { 'curved-nose-bogie-upper-fairing': 180.9791792491928, 'continuous-rounded-body-and-sculpted-nose': 10132.59936366887, 'blue-roof-and-central-nose': 2407.7276665592067, 'rounded-ivory-nose-chin-and-coupler-cover': 875.3700336697121, 'copper-belt-rising-around-cab-and-blue-nose': 333.33656437523257 },
}

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

describe('playful Shinkansen retained nose mechanisms', () => {
  it('equips both outside cabs of every Shinkansen in shortened and authentic sets', () => {
    for (const total of [3, 7, 10, 11]) for (const type of types) {
      expect(isNoseCouplingCar(type, 0, total)).toBe(true)
      expect(isNoseCouplingCar(type, total - 1, total)).toBe(true)
      expect(isNoseCouplingCar(type, 1, total)).toBe(false)
      expect(isNoseCouplingCar('e235', total - 1, total)).toBe(false)
    }
  })

  it.each(cabs)('$type $end closed cap preserves original shell and paint area and materials', ({ type, index }) => {
    const closed = createShinkansenCar(index, 3, type)
    for (const [name, expected] of Object.entries(ORIGINAL_SURFACE_AREAS[type])) {
      const fragments: THREE.Mesh[] = []
      closed.traverse(object => { if (object instanceof THREE.Mesh && (object.name === name || object.userData.sourceSurface === name)) fragments.push(object) })
      const actual = fragments.reduce((sum, mesh) => sum + area(mesh.geometry), 0)
      expect(Math.abs(actual - expected) / expected, name).toBeLessThan(.000002)
      const stationary = fragments.find(mesh => mesh.name === name)!
      for (const fragment of fragments) expect(fragment.material).toBe(stationary.material)
    }
    expect(getNoseCouplerDiagnostics(closed)?.coverTransforms.every(transform => transform.position.every(value => value === 0))).toBe(true)
    disposeTrainModel(closed)
  })

  it.each(cabs)('$type $end opens and closes retained rigid panels without scaling, fading, or replacing geometry', ({ type, index, end }) => {
    const car = createShinkansenCar(index, 3, type)
    const covers = ['left', 'right'].map(side => car.getObjectByName(`nose-opening-cover-${side}`)!)
    const geometries: THREE.BufferGeometry[] = []
    covers.forEach(cover => cover.traverse(object => { if (object instanceof THREE.Mesh) geometries.push(object.geometry) }))
    const children = covers.map(cover => [...cover.children])
    for (let step = 0; step <= 40; step++) {
      updateNoseCoupler(car, { open: step / 40, extension: Math.max(0, step / 40 - .8) * 5, locked: false, end })
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
    expect(open.coverTransforms[0].position[2]).toBeLessThan(-.1)
    expect(open.coverTransforms[1].position[2]).toBeGreaterThan(.1)
    updateNoseCoupler(car, { open: 0, extension: 0, locked: false, end })
    expect(getNoseCouplerDiagnostics(car)!.coverTransforms.every(transform => transform.position.every(value => value === 0))).toBe(true)
    disposeTrainModel(car)
  })

  it.each(cabs)('$type $end stows the complete painted cap inside its retained shell', ({ type, index, end }) => {
    const spec = getTrainCarSpec(type, index, 3)
    const car = createShinkansenCar(index, 3, type, { open: 1, extension: 1, locked: false, end })
    for (const side of ['left', 'right']) {
      const cover = car.getObjectByName(`nose-opening-cover-${side}`)!
      cover.traverse(object => {
        if (!(object instanceof THREE.Mesh) || !['cover', 'cover-fairing'].includes(object.userData.noseCouplingPart)) return
        const positions = object.geometry.getAttribute('position')
        for (let i = 0; i < positions.count; i++) {
          const point = new THREE.Vector3().fromBufferAttribute(positions, i)
          object.localToWorld(point)
          car.getObjectByName('smooth-aerodynamic-exterior')!.worldToLocal(point)
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

  it.each(cabs)('$type $end exposes the contractual mount and extended face on the physical cab end', ({ type, index, sign, end }) => {
    const spec = getTrainCarSpec(type, index, 3), profile = NOSE_COUPLER_PROFILES[type]
    const car = createShinkansenCar(index, 3, type, { open: 1, extension: 1, locked: true, end })
    const diagnostic = getNoseCouplerDiagnostics(car)!
    expect(diagnostic.pivot.x).toBeCloseTo(sign * (spec.length / 2 - profile.mountInset), 7)
    expect(diagnostic.pivot.y).toBe(profile.height)
    expect(diagnostic.matingFace.x).toBeCloseTo(sign * (spec.length / 2 - profile.mountInset + profile.extensionLength), 7)
    expect(diagnostic.pivot.distanceTo(diagnostic.matingFace)).toBeCloseTo(profile.extensionLength, 7)
    expect(profile.extensionLength - (profile.mountInset - profile.cutBack)).toBeCloseTo(.5, 7)
    expect(diagnostic.end).toBe(end)
    const contact: THREE.Object3D[] = []
    car.traverse(object => { if (isMechanicalNoseCouplerContact(object)) contact.push(object) })
    expect(contact).toHaveLength(1)
    expect(contact[0].name).toBe('nose-mechanical-coupler-head')
    expect(contact[0].userData.locked).toBe(true)
    disposeTrainModel(car)
  })

  it.each(cabs)('$type $end articulates its rigid arm at fixed length and reports actual transformed anchors', ({ type, index, sign, end }) => {
    const car = createShinkansenCar(index, 3, type, { open: 1, extension: 1, locked: true, end })
    const baseline = getNoseCouplerDiagnostics(car)!, length = NOSE_COUPLER_PROFILES[type].extensionLength
    const direction = new THREE.Vector3(sign, .04, .18).normalize()
    const target = baseline.pivot.clone().addScaledVector(direction, length)
    expect(orientNoseCoupler(car, target)).toBe(true)
    expect(getNoseCouplerDiagnostics(car)!.matingFace.distanceTo(target)).toBeLessThan(1e-7)
    expect(getNoseCouplerDiagnostics(car)!.pivot.distanceTo(getNoseCouplerDiagnostics(car)!.matingFace)).toBeCloseTo(length, 7)
    expect(getNoseCouplerDiagnostics(car)!.coverTransforms).toEqual(baseline.coverTransforms)
    const axis = new THREE.Vector3(1, .08, -.16).normalize()
    updateNoseCoupler(car, { open: 1, extension: 1, locked: true, end, axis: { x: axis.x, y: axis.y, z: axis.z } })
    const actual = getNoseCouplerDiagnostics(car)!
    const exteriorAxis = end === 'front' ? axis : new THREE.Vector3(-axis.x, axis.y, -axis.z)
    expect(actual.matingFace.distanceTo(actual.pivot.clone().addScaledVector(exteriorAxis, length))).toBeLessThan(1e-7)
    disposeTrainModel(car)
  })

  it.each(types)('%s opens only the selected end and leaves its other nose closed', type => {
    for (const end of ['front', 'rear'] as const) for (const index of [0, 2]) {
      const state = { open: 1, extension: 1, locked: true, end }
      const car = createShinkansenCar(index, 3, type, state)
      const active = index === (end === 'front' ? 0 : 2)
      expect(getNoseCouplerDiagnostics(car)?.state.open).toBe(active ? 1 : 0)
      expect(getNoseCouplerDiagnostics(car)?.state.extension).toBe(active ? 1 : 0)
      updateNoseCoupler(car, state)
      expect(getNoseCouplerDiagnostics(car)?.state.locked).toBe(active)
      disposeTrainModel(car)
    }
  })

  it('keeps middle cars without nose mechanisms and retains old saves end defaults', () => {
    for (const type of types) {
      const car = createShinkansenCar(1, 3, type, { open: 1, extension: 1, locked: true })
      expect(getNoseCouplerDiagnostics(car)).toBeNull()
      expect(updateNoseCoupler(car, { open: 1, extension: 1, locked: true })).toBe(false)
      disposeTrainModel(car)
      for (const index of [0, 2]) {
        const cab = createShinkansenCar(index, 3, type, { open: 1, extension: 1, locked: true })
        expect(getNoseCouplerDiagnostics(cab)?.state.open).toBe(index === (type === 'e6' ? 2 : 0) ? 1 : 0)
        disposeTrainModel(cab)
      }
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
