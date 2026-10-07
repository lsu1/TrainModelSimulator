import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { createShinkansenCar, shinkansenSurface } from './shinkansenModel'
import { createE235Car, createTrainCar, createTrainConnection, disposeTrainModel, updateE235Connection } from './trainModel'
import { getTrainCarSpec, getTrainSpec } from './trains'

const types = ['e5', 'e6', 'e7'] as const
describe('procedural Shinkansen models', () => {
  it.each(types)('%s has outward cabs, a smooth bounded nose, and two real bogie pivots', type => {
    for (const index of [0, 1, 2]) {
      const spec = getTrainCarSpec(type, index, 3), car = createShinkansenCar(index, 3, type)
      expect(car.userData).toMatchObject({ model: spec.model, trainType: type, length: spec.length, scale: 160, bogieOffset: spec.bogieOffset, cab: index !== 1, noseDirection: index === 0 ? 1 : index === 2 ? -1 : 0 })
      expect(car.getObjectByName('bogie-front')?.position.x).toBe(spec.bogieOffset)
      expect(car.getObjectByName('bogie-rear')?.position.x).toBe(-spec.bogieOffset)
      expect(car.getObjectByName('coupling-front')?.position.x).toBe(spec.length / 2)
      expect(car.getObjectByName('coupling-rear')?.position.x).toBe(-spec.length / 2)
      expect(Boolean(car.getObjectByName('gangway-front'))).toBe(index !== 0)
      expect(Boolean(car.getObjectByName('gangway-rear'))).toBe(index !== 2)
      const shell = car.getObjectByName('continuous-rounded-body-and-sculpted-nose') as THREE.Mesh
      shell.geometry.computeBoundingBox()
      expect(shell.geometry.boundingBox!.min.x).toBeCloseTo(-spec.length / 2, 4)
      expect(shell.geometry.boundingBox!.max.x).toBeCloseTo(spec.length / 2, 4)
      expect(shell.geometry.boundingBox!.min.z).toBeCloseTo(-spec.width / 2, 4)
      expect(shell.geometry.boundingBox!.max.z).toBeCloseTo(spec.width / 2, 4)
      if (index !== 1) expect(shell.geometry.getAttribute('position').count).toBeGreaterThan(3000)
      car.traverse(object => {
        if (!(object instanceof THREE.Mesh || object instanceof THREE.Line)) return
        const attributes = object.geometry.attributes
        for (const attribute of Object.values(attributes) as THREE.BufferAttribute[]) {
          expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true)
        }
      })
      if (index === 2) expect(car.getObjectByName('smooth-aerodynamic-exterior')?.rotation.y).toBe(Math.PI)
      disposeTrainModel(car)
    }
  })

  it('the E5 hood stays broader than E6, while E7 has a distinctly shorter nose', () => {
    const e5 = getTrainCarSpec('e5', 0, 3), e6 = getTrainCarSpec('e6', 0, 3), e7 = getTrainCarSpec('e7', 0, 3)
    const hood = (spec: typeof e5, type: 'e5' | 'e6') => shinkansenSurface(spec, type, spec.length / 2 - spec.noseLength * .30, 0).z / (spec.width / 2)
    expect(hood(e5, 'e5')).toBeGreaterThan(hood(e6, 'e6') + .10)
    expect(e7.noseLength).toBeLessThan(e6.noseLength * .75)
    expect(e5.noseLength).toBeGreaterThan(e6.noseLength)
  })

  it.each(types)('%s keeps its forward wheels below the nose belly', type => {
    const spec = getTrainCarSpec(type, 0, 3)
    const belly = shinkansenSurface(spec, type, spec.bogieOffset, -Math.PI / 2)
    expect(belly.y).toBeGreaterThan(4.5)
    // The slender E6 hood is narrower than its suspension frame here; its
    // belly remains above that frame and both axles, so no wheel cuts the shell.
    for (const x of [spec.bogieOffset - 6.2, spec.bogieOffset + 6.2]) {
      expect(shinkansenSurface(spec, type, x, -Math.PI / 2).y).toBeGreaterThan(4.5)
    }
  })

  it('has series-specific paint and cab details rather than recoloring one geometry', () => {
    const e5 = createTrainCar(0, 3, 'e5'), e6 = createTrainCar(0, 3, 'e6'), e7 = createTrainCar(0, 3, 'e7')
    expect(e5.getObjectByName('pink-belt-line')).toBeDefined()
    expect(e5.getObjectByName('five-cab-crown-headlights')).toBeDefined()
    expect(e6.getObjectByName('silver-side-belt-below-windows')).toBeDefined()
    expect(e6.getObjectByName('swept-triangular-headlight-pocket')).toBeDefined()
    expect(e7.getObjectByName('copper-belt-rising-around-cab-and-blue-nose')).toBeDefined()
    expect(e7.getObjectByName('thin-blue-line-below-copper-belt')).toBeDefined()
    for (const car of [e5, e6, e7]) disposeTrainModel(car)
  })

  it.each(types)('%s glass and headlight pockets have interior vertices above the curved body', type => {
    const car = createTrainCar(0, 3, type), spec = getTrainCarSpec(type, 0, 3)
    const window = car.getObjectByName('small-individual-passenger-windows') as THREE.Mesh
    expect(window.geometry.getAttribute('position').count).toBeGreaterThan(75)
    const positions = window.geometry.getAttribute('position')
    for (let vertex = 0; vertex < positions.count; vertex++) {
      const y = positions.getY(vertex)
      const normalized = (y - (spec.height + 4.8) / 2) / ((spec.height - 4.8) / 2)
      const theta = Math.asin(Math.sign(normalized) * Math.abs(normalized) ** (1 / .67))
      const body = shinkansenSurface({ ...spec, noseLength: 0 }, type, 0, theta)
      expect(positions.getZ(vertex) - body.z).toBeGreaterThan(.08)
    }
    const pocket = car.getObjectByName('swept-triangular-headlight-pocket') as THREE.Mesh | undefined
    if (pocket) expect(pocket.geometry.getAttribute('position').count).toBeGreaterThan(60)
    expect(car.getObjectByName('rounded-silver-nose-chin-and-coupler-cover')).toBeDefined()
    expect(car.getObjectByName('curved-nose-bogie-upper-fairing')).toBeDefined()
    disposeTrainModel(car)
  })

  it('preserves the original Yamanote factory geometry and dimensions', () => {
    const generic = createTrainCar(0, 3), original = createE235Car(0, 3)
    expect(generic.userData).toEqual(original.userData)
    expect(generic.children.map(child => child.name)).toEqual(original.children.map(child => child.name))
    expect(generic.getObjectByName('four-green-doors-per-side')).toBeDefined()
    disposeTrainModel(generic); disposeTrainModel(original)
  })

  it.each(types)('%s flexible fairing follows both actual body-end attachment centres', type => {
    const connection = createTrainConnection(type), spec = getTrainSpec(type)
    const first = new THREE.Vector3(0, 3.45, 0), second = new THREE.Vector3(40, 3.45, 0)
    const firstMount = new THREE.Vector3(10, (spec.height + 4.8) / 2, 0), secondMount = new THREE.Vector3(14.2, (spec.height + 4.8) / 2, 0)
    updateE235Connection(connection, first, second, firstMount, secondMount)
    const geometry = (connection.getObjectByName('flexible-gangway-bellows') as THREE.Mesh).geometry
    const vertices = geometry.getAttribute('position')
    for (const [start, expected] of [[0, firstMount], [vertices.count - 8, secondMount]] as const) {
      const center = new THREE.Vector3()
      for (let i = 0; i < 4; i++) center.add(new THREE.Vector3().fromBufferAttribute(vertices, start + i))
      expect(center.multiplyScalar(.25).distanceTo(expected)).toBeLessThan(.00001)
    }
    expect(connection.userData.gangwayHalfWidth * 2).toBeGreaterThan(16)
    disposeTrainModel(connection)
  })

  it('disposes the new door-seam line geometry and material with the car', () => {
    const car = createTrainCar(0, 3, 'e7')
    const line = car.getObjectByName('flush-single-leaf-door-seams') as THREE.Line
    const geometryDispose = vi.spyOn(line.geometry, 'dispose')
    const materialDispose = vi.spyOn(line.material as THREE.Material, 'dispose')
    disposeTrainModel(car)
    expect(geometryDispose).toHaveBeenCalledOnce()
    expect(materialDispose).toHaveBeenCalledOnce()
  })
})
