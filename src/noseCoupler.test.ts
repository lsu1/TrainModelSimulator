import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { NOSE_COUPLER_PROFILES } from './couplingTypes'
import { createShinkansenCar, shinkansenSurface } from './shinkansenModel'
import { createE235Car, disposeTrainModel } from './trainModel'
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
      expect(isNoseCouplingCar('e235', total - 1, total)).toBe(true)
      expect(isNoseCouplingCar('e235', 1, total)).toBe(false)
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

  it.each(cabs)('$type $end follows a rounded mirrored rigid sweep and closes along exactly the opening path', ({ type, index, end }) => {
    const car = createShinkansenCar(index, 3, type)
    const exterior = car.getObjectByName('smooth-aerodynamic-exterior')!
    const covers = ['left', 'right'].map(side => car.getObjectByName(`nose-opening-cover-${side}`)!)
    const profile = NOSE_COUPLER_PROFILES[type], spec = getTrainCarSpec(type, index, 3)
    // A point near the tip detects actual rotation around the cap, rather than
    // merely reading a translation which hides the source-coordinate pivot.
    const point = new THREE.Vector3(spec.length / 2, profile.height, .5)
    const sample = (open: number) => {
      updateNoseCoupler(car, { open, extension: 0, locked: false, end })
      const transformed = exterior.worldToLocal(covers[0].localToWorld(point.clone()))
      return { transformed, diagnostics: getNoseCouplerDiagnostics(car)!.coverTransforms }
    }
    const opening = Array.from({ length: 41 }, (_, i) => sample(i / 40))
    const midpoint = opening[20].diagnostics
    expect(Math.abs(midpoint[0].quaternion[1])).toBeGreaterThan(.05)
    expect(midpoint[0].position[0]).toBeCloseTo(midpoint[1].position[0], 12)
    expect(midpoint[0].position[1]).toBeCloseTo(midpoint[1].position[1], 12)
    expect(midpoint[0].position[2]).toBeCloseTo(-midpoint[1].position[2], 12)
    expect(midpoint[0].quaternion[1]).toBeCloseTo(-midpoint[1].quaternion[1], 12)
    expect(midpoint[0].quaternion[3]).toBeCloseTo(midpoint[1].quaternion[3], 12)
    const a = opening[8].transformed, b = opening[20].transformed, c = opening[32].transformed
    expect(Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x))).toBeGreaterThan(2)
    for (let i = 40; i >= 0; i--) {
      const closing = sample(i / 40)
      expect(closing.diagnostics).toEqual(opening[i].diagnostics)
      expect(closing.transformed.toArray()).toEqual(opening[i].transformed.toArray())
    }
    for (const i of [0, 40]) for (const cover of opening[i].diagnostics) {
      expect(cover.quaternion).toEqual([0, 0, 0, 1])
    }
    // Source vertices already sit near the cab end. A compensated pivot keeps
    // the rigid tip in the nose's vicinity throughout the sweep.
    for (const { transformed } of opening) expect(transformed.distanceTo(point)).toBeLessThan(profile.cutBack + 14)
    disposeTrainModel(car)
  })

  it.each(types)('%s has smooth velocity and acceleration through the old slide-stage boundaries', type => {
    const car = createShinkansenCar(0, 3, type), spec = getTrainCarSpec(type, 0, 3)
    const cover = car.getObjectByName('nose-opening-cover-left')!
    const point = new THREE.Vector3(spec.length / 2, 9.5, .5), h = .0001
    const sample = (open: number) => {
      updateNoseCoupler(car, { open, extension: 0, locked: false, end: 'front' })
      return cover.localToWorld(point.clone())
    }
    const acceleration = (open: number) => sample(open + h).add(sample(open - h)).addScaledVector(sample(open), -2).multiplyScalar(1 / h ** 2)
    for (const boundary of [.14, .17, .18, .22, .44, .48, .51, .55]) {
      expect(acceleration(boundary - h).distanceTo(acceleration(boundary + h))).toBeLessThan(2)
    }
    expect(sample(h).distanceTo(sample(0)) / h).toBeLessThan(.0001)
    expect(sample(1).distanceTo(sample(1 - h)) / h).toBeLessThan(.0001)
    disposeTrainModel(car)
  })

  it('shares the same normalized panel rotation for E5, E6, and E7', () => {
    const cars = types.map(type => createShinkansenCar(0, 3, type))
    for (const open of [.1, .25, .5, .75, .9]) {
      const rotations = cars.map(car => {
        updateNoseCoupler(car, { open, extension: 0, locked: false, end: 'front' })
        return getNoseCouplerDiagnostics(car)!.coverTransforms.map(cover => cover.quaternion)
      })
      expect(rotations[1]).toEqual(rotations[0])
      expect(rotations[2]).toEqual(rotations[0])
    }
    cars.forEach(disposeTrainModel)
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

describe('exposed Yamanote emergency cab couplers', () => {
  it.each(['front', 'rear'] as const)('%s cab keeps its flat face and a permanently visible under-cab fitting', end => {
    const index = end === 'front' ? 0 : 2, sign = end === 'front' ? 1 : -1
    const car = createE235Car(index, 3), profile = NOSE_COUPLER_PROFILES.e235
    const body = car.getObjectByName('stainless-steel-body') as THREE.Mesh
    const face = car.getObjectByName('E235-green-front-and-destination') as THREE.Mesh
    const geometry = body.geometry, faceGeometry = face.geometry
    const bodyArea = area(geometry), faceArea = area(faceGeometry)
    const head = car.getObjectByName('cab-mechanical-coupler-head') as THREE.Mesh
    const shank = car.getObjectByName('cab-mechanical-coupler-shank') as THREE.Mesh
    expect(car.getObjectByName('cab-coupler')).toBeUndefined()
    expect(car.getObjectByName(`gangway-${end}`)).toBeUndefined()
    expect(car.getObjectByName('nose-opening-cover-left')).toBeUndefined()
    expect(car.getObjectByName('nose-opening-cover-right')).toBeUndefined()
    for (const state of [
      { open: 0, extension: 0, locked: false },
      { open: .5, extension: .5, locked: false },
      { open: 1, extension: 1, locked: true },
    ]) {
      updateNoseCoupler(car, { ...state, end })
      const diagnostic = getNoseCouplerDiagnostics(car)!
      expect(diagnostic.mechanism).toBe('exposed')
      expect(diagnostic.coverTransforms).toEqual([])
      expect(diagnostic.state).toMatchObject({ open: 0, extension: 1, locked: state.locked, end })
      expect(diagnostic.pivot.x).toBeCloseTo(sign * (133.3 / 2 - profile.mountInset), 7)
      expect(diagnostic.pivot.y).toBe(profile.height)
      expect(diagnostic.matingFace.x).toBeCloseTo(sign * (133.3 / 2 + 2.5), 7)
      expect(diagnostic.pivot.distanceTo(diagnostic.matingFace)).toBeCloseTo(profile.extensionLength, 7)
      expect(head.visible && shank.visible).toBe(true)
      expect(head.scale.toArray()).toEqual([1, 1, 1])
      expect(shank.scale.toArray()).toEqual([1, 1, 1])
      expect(body.geometry).toBe(geometry)
      expect(face.geometry).toBe(faceGeometry)
      expect(area(body.geometry)).toBe(bodyArea)
      expect(area(face.geometry)).toBe(faceArea)
    }
    const contact: THREE.Object3D[] = []
    car.traverse(object => { if (isMechanicalNoseCouplerContact(object)) contact.push(object) })
    expect(contact).toEqual([head])
    expect(isMechanicalNoseCouplerContact(shank)).toBe(false)
    head.geometry.computeBoundingBox()
    const actualMatingFace = head.localToWorld(new THREE.Vector3(head.geometry.boundingBox!.max.x, 0, 0))
    expect(actualMatingFace.distanceTo(getNoseCouplerDiagnostics(car)!.matingFace)).toBeLessThan(1e-7)
    disposeTrainModel(car)
  })

  it.each(['front', 'rear'] as const)('%s head swivels at rigid reach and only its selected cab locks', end => {
    const index = end === 'front' ? 0 : 2, sign = end === 'front' ? 1 : -1
    const car = createE235Car(index, 3), profile = NOSE_COUPLER_PROFILES.e235
    const baseline = getNoseCouplerDiagnostics(car)!
    const direction = new THREE.Vector3(sign, .08, -.16).normalize()
    const target = baseline.pivot.clone().addScaledVector(direction, profile.extensionLength)
    expect(orientNoseCoupler(car, target)).toBe(true)
    expect(getNoseCouplerDiagnostics(car)!.matingFace.distanceTo(target)).toBeLessThan(1e-7)
    const axis = new THREE.Vector3(1, .06, -.12).normalize()
    updateNoseCoupler(car, { open: 0, extension: 1, locked: true, end, axis: { x: axis.x, y: axis.y, z: axis.z } })
    const actual = getNoseCouplerDiagnostics(car)!, carAxis = new THREE.Vector3(sign * axis.x, axis.y, sign * axis.z)
    expect(actual.matingFace.distanceTo(actual.pivot.clone().addScaledVector(carAxis, profile.extensionLength))).toBeLessThan(1e-7)
    expect(actual.pivot.distanceTo(actual.matingFace)).toBeCloseTo(profile.extensionLength, 7)
    expect(actual.coverTransforms).toEqual([])
    updateNoseCoupler(car, { open: 0, extension: 1, locked: true, end: end === 'front' ? 'rear' : 'front', axis })
    expect(getNoseCouplerDiagnostics(car)!.state).toMatchObject({ open: 0, extension: 1, locked: false })
    expect(getNoseCouplerDiagnostics(car)!.matingFace).toEqual(baseline.matingFace)
    disposeTrainModel(car)
  })

  it('keeps intermediate E235 cars and their inter-car gangways independent of cab fittings', () => {
    const car = createE235Car(1, 3)
    expect(getNoseCouplerDiagnostics(car)).toBeNull()
    expect(car.getObjectByName('cab-mechanical-coupler-head')).toBeUndefined()
    expect(car.getObjectByName('gangway-front')).toBeDefined()
    expect(car.getObjectByName('gangway-rear')).toBeDefined()
    disposeTrainModel(car)
  })
})
