import * as THREE from 'three'
import { createShinkansenCar } from './shinkansenModel'
import { getTrainSpec } from './trains'
import type { TrainType } from './trains'

/** Japanese N scale: 1:150; every length below is in model millimetres. */
export const TRAIN_SCALE = 150
export const CAR_LENGTH = 133.3
export const CAR_SPACING = 137.5

/** Visual reference: KATO E235 Yamanote, https://www.katomodels.com/product/n/e235_yamanote_slm.
 * Original procedural geometry and markings; this is a visual approximation, not a KATO model asset.
 */
const DOOR_POSITIONS = [-45.2, -15.1, 15.1, 45.2]
const BOGIE_DISTANCE = 43.7
const COUPLING_HEIGHT = 3.45
const GANGWAY_HEIGHT = 14.7
const CONNECTION_AXIS = new THREE.Vector3(1, 0, 0)
const BELLOWS_SECTIONS = 9

type BoxInstance = { position: [number, number, number]; scale: [number, number, number]; rotation?: THREE.Euler }

function instancedBoxes(parent: THREE.Object3D, material: THREE.Material, instances: BoxInstance[], name: string) {
  if (!instances.length) return undefined
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, instances.length)
  mesh.name = name
  const matrix = new THREE.Matrix4()
  const quaternion = new THREE.Quaternion()
  for (let i = 0; i < instances.length; i += 1) {
    const item = instances[i]
    quaternion.setFromEuler(item.rotation ?? new THREE.Euler())
    matrix.compose(new THREE.Vector3(...item.position), quaternion, new THREE.Vector3(...item.scale))
    mesh.setMatrixAt(i, matrix)
  }
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.instanceMatrix.needsUpdate = true
  parent.add(mesh)
  return mesh
}

/** Extrude a Y/Z cross-section along the X direction. */
function shell(profile: [number, number][], length: number, material: THREE.Material, name: string) {
  const shape = new THREE.Shape()
  profile.forEach(([z, y], index) => index ? shape.lineTo(z, y) : shape.moveTo(z, y))
  shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false, steps: 1, curveSegments: 8 })
  // Native extrusion is +Z. Map shape X to train Z, and extrusion Z to train X.
  const positions = geometry.getAttribute('position')
  for (let i = 0; i < positions.count; i += 1) {
    const z = positions.getX(i)
    const y = positions.getY(i)
    const x = positions.getZ(i) - length / 2
    positions.setXYZ(i, x, y, -z)
  }
  geometry.computeVertexNormals()
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = name
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

function frontGeometry() {
  const halfWidth = 9.3
  const halfHeight = 9.65
  const upperRadius = 2.2
  const lowerRadius = 0.65
  const shape = new THREE.Shape()
  shape.moveTo(-halfWidth + lowerRadius, -halfHeight)
  shape.lineTo(halfWidth - lowerRadius, -halfHeight)
  shape.quadraticCurveTo(halfWidth, -halfHeight, halfWidth, -halfHeight + lowerRadius)
  shape.lineTo(halfWidth, halfHeight - upperRadius)
  shape.quadraticCurveTo(halfWidth, halfHeight, halfWidth - upperRadius, halfHeight)
  shape.lineTo(-halfWidth + upperRadius, halfHeight)
  shape.quadraticCurveTo(-halfWidth, halfHeight, -halfWidth, halfHeight - upperRadius)
  shape.lineTo(-halfWidth, -halfHeight + lowerRadius)
  shape.quadraticCurveTo(-halfWidth, -halfHeight, -halfWidth + lowerRadius, -halfHeight)
  const geometry = new THREE.ShapeGeometry(shape, 8)
  const positions = geometry.getAttribute('position')
  const uv = geometry.getAttribute('uv')
  for (let i = 0; i < positions.count; i += 1) {
    uv.setXY(i, (positions.getX(i) + halfWidth) / (halfWidth * 2), (positions.getY(i) + halfHeight) / (halfHeight * 2))
  }
  return geometry
}

function canvasTexture(width: number, height: number, paint: (ctx: CanvasRenderingContext2D) => void) {
  if (typeof document === 'undefined') return undefined
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return undefined
  paint(context)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

function greenDoorTexture() {
  return canvasTexture(128, 256, ctx => {
    const gradient = ctx.createLinearGradient(0, 0, 0, 256)
    gradient.addColorStop(0, '#c6de73')
    gradient.addColorStop(0.42, '#a0cc36')
    gradient.addColorStop(1, '#83bc2c')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 128, 256)
    // E235's little square fade pattern on its vertical green door panels.
    for (let y = 4; y < 88; y += 8) {
      for (let x = 4; x < 128; x += 8) {
        const alpha = Math.max(0, (88 - y) / 160 + ((x + y) % 24 === 0 ? 0.12 : 0))
        ctx.fillStyle = `rgba(242,247,222,${alpha})`
        ctx.fillRect(x, y, 4, 4)
      }
    }
    ctx.fillStyle = '#596554'
    ctx.fillRect(63, 0, 2, 256)
    ctx.fillStyle = '#d4d9ce'
    ctx.fillRect(0, 252, 128, 4)
    ctx.fillStyle = '#424b40'
    ctx.fillRect(58, 159, 3, 14)
    ctx.fillRect(67, 159, 3, 14)
  })
}

function faceTexture(tail: boolean) {
  return canvasTexture(512, 512, ctx => {
    // Own artwork, based on the E235's recognisable black and uguisu-green face.
    ctx.fillStyle = '#b6c0c5'
    ctx.fillRect(0, 0, 512, 512)
    const green = ctx.createLinearGradient(0, 100, 0, 470)
    green.addColorStop(0, '#c6df7c')
    green.addColorStop(0.4, '#a7d43b')
    green.addColorStop(1, '#9acb32')
    ctx.fillStyle = green
    ctx.beginPath()
    ctx.roundRect(18, 30, 476, 443, 22)
    ctx.fill()
    ctx.fillStyle = '#121c24'
    ctx.beginPath()
    ctx.roundRect(34, 54, 444, 380, 19)
    ctx.fill()
    // LED destination and service number above the driver's windscreen.
    ctx.fillStyle = '#000000'
    ctx.fillRect(125, 65, 260, 59)
    ctx.textAlign = 'center'
    ctx.font = 'bold 30px sans-serif'
    ctx.fillStyle = '#f4f6e8'
    ctx.fillText('山手線', 256, 92)
    ctx.font = '11px sans-serif'
    ctx.fillStyle = '#d4eeb5'
    ctx.fillText('YAMANOTE LINE', 256, 111)
    ctx.font = '12px monospace'
    ctx.textAlign = 'left'
    ctx.fillText('0913G', 45, 119)
    const reflection = ctx.createLinearGradient(25, 135, 470, 285)
    reflection.addColorStop(0, '#3e5d72')
    reflection.addColorStop(0.3, '#1a2d3c')
    reflection.addColorStop(1, '#111c25')
    ctx.fillStyle = reflection
    ctx.fillRect(48, 137, 416, 138)
    ctx.strokeStyle = '#71808b'
    ctx.lineWidth = 3
    ctx.strokeRect(48, 137, 416, 138)
    ctx.strokeStyle = '#94a5b0'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(68, 151)
    ctx.lineTo(443, 151)
    ctx.stroke()
    ctx.strokeStyle = '#0b1219'
    ctx.lineWidth = 7
    ctx.beginPath()
    ctx.moveTo(141, 267)
    ctx.lineTo(193, 247)
    ctx.lineTo(233, 263)
    ctx.moveTo(333, 267)
    ctx.lineTo(375, 242)
    ctx.stroke()
    ctx.fillStyle = '#acb9bc'
    ctx.fillRect(49, 289, 414, 3)
    const fade = ctx.createLinearGradient(0, 295, 0, 434)
    fade.addColorStop(0, '#111c23')
    fade.addColorStop(0.65, '#304424')
    fade.addColorStop(1, '#95c538')
    ctx.fillStyle = fade
    ctx.fillRect(35, 295, 442, 134)
    // The black lower face dissolves into little green squares, not a solid stripe.
    for (let y = 300; y < 430; y += 8) {
      for (let x = 40; x < 471; x += 8) {
        const size = 1.1 + ((y - 300) / 130) * 5.9
        ctx.fillStyle = '#a4d33f'
        ctx.fillRect(x, y, size, size)
      }
    }
    ctx.font = '13px sans-serif'
    ctx.fillStyle = '#e0e9da'
    ctx.textAlign = 'left'
    ctx.fillText('03', 52, 272)
    // Paint lamp sockets; separate emissive meshes provide the lenses.
    ctx.fillStyle = '#222e35'
    ctx.fillRect(44, 69, 54, 25)
    ctx.fillRect(414, 69, 54, 25)
    if (tail) {
      ctx.fillStyle = '#d64636'
      ctx.fillRect(48, 390, 29, 12)
      ctx.fillRect(435, 390, 29, 12)
    }
  })
}

function sideDisplayTexture(index: number) {
  return canvasTexture(512, 96, ctx => {
    ctx.fillStyle = '#151d22'
    ctx.fillRect(0, 0, 512, 96)
    ctx.fillStyle = '#d5e8b9'
    ctx.textAlign = 'center'
    ctx.font = 'bold 44px sans-serif'
    ctx.fillText('山手線', 194, 58)
    ctx.fillStyle = '#fafce9'
    ctx.font = '35px sans-serif'
    ctx.fillText(String(11 - index), 443, 59)
    ctx.fillStyle = '#8dcc48'
    ctx.fillRect(387, 12, 5, 70)
  })
}

function jrSideTexture() {
  return canvasTexture(128, 80, ctx => {
    ctx.clearRect(0, 0, 128, 80)
    ctx.fillStyle = '#83b93b'
    ctx.font = 'italic bold 70px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('JR', 63, 65)
  })
}

function addBogie(car: THREE.Group, x: number, wheel: THREE.Material, rubber: THREE.Material, metal: THREE.Material, name: string) {
  const bogie = new THREE.Group()
  bogie.name = name
  bogie.position.x = x
  instancedBoxes(bogie, rubber, [
    { position: [0, 2.9, 0], scale: [14.3, 2.5, 7.8] },
    { position: [0, 2.6, -6.1], scale: [14.8, 1.9, 1.7] },
    { position: [0, 2.6, 6.1], scale: [14.8, 1.9, 1.7] },
  ], 'bogie-frame')
  const wheelGeometry = new THREE.CylinderGeometry(2.35, 2.35, 0.95, 12)
  wheelGeometry.rotateX(Math.PI / 2)
  const wheels = new THREE.InstancedMesh(wheelGeometry, wheel, 4)
  wheels.name = '9mm-gauge-wheels'
  const m = new THREE.Matrix4()
  let i = 0
  for (const axleX of [-5.6, 5.6]) {
    for (const z of [-4.9, 4.9]) {
      m.makeTranslation(axleX, 2.35, z)
      wheels.setMatrixAt(i++, m)
    }
  }
  wheels.castShadow = true
  bogie.add(wheels)
  const axleGeometry = new THREE.CylinderGeometry(0.48, 0.48, 11.9, 6)
  axleGeometry.rotateX(Math.PI / 2)
  const axles = new THREE.InstancedMesh(axleGeometry, metal, 2)
  for (let axle = 0; axle < 2; axle += 1) {
    m.makeTranslation(axle ? 5.6 : -5.6, 2.35, 0)
    axles.setMatrixAt(axle, m)
  }
  bogie.add(axles)
  instancedBoxes(bogie, wheel, [-5.6, 5.6].flatMap(axleX => [-6.95, 6.95].map(z => ({
    position: [axleX, 2.7, z] as [number, number, number],
    scale: [2.5, 2.3, 0.9] as [number, number, number],
  }))), 'axle-boxes')
  car.add(bogie)
}

function addPantograph(car: THREE.Group, material: THREE.Material) {
  const group = new THREE.Group()
  group.name = 'single-arm-pantograph'
  group.position.set(-29, 25.45, 0)
  instancedBoxes(group, material, [
    { position: [0, 0.8, 0], scale: [9, 1.2, 7] },
    { position: [-2.1, 4.7, 0], scale: [0.7, 7.7, 0.7], rotation: new THREE.Euler(0, 0, -0.5) },
    { position: [0.45, 9.5, 0], scale: [0.62, 5.5, 0.62], rotation: new THREE.Euler(0, 0, 0.82) },
    { position: [2.2, 11.6, 0], scale: [1.5, 0.45, 10.2] },
    { position: [2.2, 11.9, 0], scale: [0.45, 0.25, 12.5] },
  ], 'pantograph-arms')
  car.add(group)
}

type E235ConnectionParts = {
  drawbar: THREE.Mesh
  couplingHead: THREE.Mesh
  firstPivot: THREE.Mesh
  secondPivot: THREE.Mesh
  bellows: THREE.Mesh<THREE.BufferGeometry>
  tangent: THREE.Vector3
  center: THREE.Vector3
  corner: THREE.Vector3
  edge: THREE.Vector3
  triangleNormal: THREE.Vector3
  orientation: THREE.Quaternion
  firstOrientation: THREE.Quaternion
  secondOrientation: THREE.Quaternion
}

/** One reusable drawbar and flexible vestibule for two neighboring body ends. */
export function createE235Connection(): THREE.Group {
  const connection = new THREE.Group()
  connection.name = 'articulated-inter-car-connection'
  const rubber = new THREE.MeshStandardMaterial({ color: '#20272b', roughness: 0.86, side: THREE.DoubleSide })
  const metal = new THREE.MeshStandardMaterial({ color: '#3c474d', metalness: 0.55, roughness: 0.57 })
  const drawbar = new THREE.Mesh(new THREE.BoxGeometry(1, 0.9, 1.5), metal)
  drawbar.name = 'articulated-drawbar'
  const couplingHead = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.35, 2.1), metal)
  couplingHead.name = 'joined-coupling-heads'
  const pivotGeometry = new THREE.CylinderGeometry(0.85, 0.85, 0.75, 10)
  const firstPivot = new THREE.Mesh(pivotGeometry, metal)
  const secondPivot = new THREE.Mesh(pivotGeometry, metal)
  firstPivot.name = 'coupling-pivot-first'
  secondPivot.name = 'coupling-pivot-second'

  // Open rectangular accordion tube: both end rings follow their own car's
  // orientation, while the intermediate folds articulate across the short gap.
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BELLOWS_SECTIONS * 8 * 3), 3).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(BELLOWS_SECTIONS * 8 * 3), 3).setUsage(THREE.DynamicDrawUsage))
  const indices: number[] = []
  for (let section = 0; section < BELLOWS_SECTIONS - 1; section += 1) {
    const first = section * 8
    const second = first + 8
    for (let corner = 0; corner < 4; corner += 1) {
      const next = (corner + 1) % 4
      indices.push(first + corner, second + corner, second + next, first + corner, second + next, first + next)
      indices.push(first + 4 + corner, second + 4 + next, second + 4 + corner, first + 4 + corner, first + 4 + next, second + 4 + next)
    }
  }
  for (const first of [0, (BELLOWS_SECTIONS - 1) * 8]) {
    for (let corner = 0; corner < 4; corner += 1) {
      const next = (corner + 1) % 4
      indices.push(first + corner, first + next, first + 4 + next, first + corner, first + 4 + next, first + 4 + corner)
    }
  }
  geometry.setIndex(indices)
  const bellows = new THREE.Mesh(geometry, rubber)
  bellows.name = 'flexible-gangway-bellows'
  // The geometry follows attachment points directly, so its bounds change on
  // every bend. Ten small connectors do not need a per-frame bounds rebuild.
  bellows.frustumCulled = false
  connection.add(drawbar, couplingHead, firstPivot, secondPivot, bellows)
  for (const mesh of [drawbar, couplingHead, firstPivot, secondPivot, bellows]) {
    mesh.castShadow = true
    mesh.receiveShadow = true
  }
  connection.userData.connectionParts = {
    drawbar, couplingHead, firstPivot, secondPivot, bellows,
    tangent: new THREE.Vector3(), center: new THREE.Vector3(), corner: new THREE.Vector3(),
    edge: new THREE.Vector3(), triangleNormal: new THREE.Vector3(),
    orientation: new THREE.Quaternion(), firstOrientation: new THREE.Quaternion(), secondOrientation: new THREE.Quaternion(),
  } satisfies E235ConnectionParts
  return connection
}

/**
 * Coupling pivot points, body-end gangway points, and car orientations use the
 * connection parent's coordinate space, in model millimetres. The drawbar may
 * run underneath the body from bogie-mounted pins, with its joined heads midway
 * between the pins. Geometry and scratch objects are reused each frame.
 * Dispose the connection with disposeTrainModel when removing the consist.
 */
export function updateE235Connection(
  connection: THREE.Group,
  firstCoupling: THREE.Vector3,
  secondCoupling: THREE.Vector3,
  firstGangway: THREE.Vector3,
  secondGangway: THREE.Vector3,
  firstCarOrientation?: THREE.Quaternion,
  secondCarOrientation?: THREE.Quaternion,
) {
  const parts = connection.userData.connectionParts as E235ConnectionParts
  const length = parts.tangent.subVectors(secondCoupling, firstCoupling).length()
  parts.orientation.setFromUnitVectors(CONNECTION_AXIS, parts.tangent.multiplyScalar(1 / Math.max(length, 1e-6)))
  parts.drawbar.position.addVectors(firstCoupling, secondCoupling).multiplyScalar(0.5)
  parts.drawbar.quaternion.copy(parts.orientation)
  parts.drawbar.scale.x = length
  parts.couplingHead.position.copy(parts.drawbar.position)
  parts.couplingHead.quaternion.copy(parts.orientation)
  parts.firstPivot.position.copy(firstCoupling)
  parts.secondPivot.position.copy(secondCoupling)
  parts.firstOrientation.copy(firstCarOrientation ?? parts.orientation)
  parts.secondOrientation.copy(secondCarOrientation ?? parts.firstOrientation)
  const positions = parts.bellows.geometry.getAttribute('position') as THREE.BufferAttribute
  for (let section = 0; section < BELLOWS_SECTIONS; section += 1) {
    const t = section / (BELLOWS_SECTIONS - 1)
    const fold = section === 0 || section === BELLOWS_SECTIONS - 1 || section % 2 === 0 ? 0 : -0.22
    parts.center.lerpVectors(firstGangway, secondGangway, t)
    parts.orientation.slerpQuaternions(parts.firstOrientation, parts.secondOrientation, t)
    for (let vertex = 0; vertex < 8; vertex += 1) {
      const corner = vertex % 4
      const inset = vertex >= 4 ? 0.27 : 0
      const halfHeight = (connection.userData.gangwayHalfHeight ?? 7) + fold - inset
      const halfWidth = (connection.userData.gangwayHalfWidth ?? 2.85) + fold - inset
      parts.corner.set(0, corner < 2 ? halfHeight : -halfHeight, corner === 0 || corner === 3 ? -halfWidth : halfWidth)
      parts.corner.applyQuaternion(parts.orientation).add(parts.center)
      positions.setXYZ(section * 8 + vertex, parts.corner.x, parts.corner.y, parts.corner.z)
    }
  }
  positions.needsUpdate = true
  const normals = parts.bellows.geometry.getAttribute('normal') as THREE.BufferAttribute
  const normalValues = normals.array as Float32Array
  const indices = parts.bellows.geometry.getIndex()!
  normalValues.fill(0)
  for (let triangle = 0; triangle < indices.count; triangle += 3) {
    const a = indices.getX(triangle)
    const b = indices.getX(triangle + 1)
    const c = indices.getX(triangle + 2)
    parts.corner.fromBufferAttribute(positions, a)
    parts.edge.fromBufferAttribute(positions, b).sub(parts.corner)
    parts.triangleNormal.fromBufferAttribute(positions, c).sub(parts.corner)
    parts.triangleNormal.crossVectors(parts.edge, parts.triangleNormal)
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const offset = indices.getX(triangle + vertex) * 3
      normalValues[offset] += parts.triangleNormal.x
      normalValues[offset + 1] += parts.triangleNormal.y
      normalValues[offset + 2] += parts.triangleNormal.z
    }
  }
  for (let vertex = 0; vertex < normals.count; vertex += 1) {
    parts.corner.fromBufferAttribute(normals, vertex).normalize()
    normals.setXYZ(vertex, parts.corner.x, parts.corner.y, parts.corner.z)
  }
  normals.needsUpdate = true
}

/**
 * A self-contained E235-0 Yamanote car. The first car faces +X, the last -X.
 * +Y is up and the wheel treads touch Y=0. Bogies are named bogie-front/rear.
 * Materials are shared inside this car, but never through a module-level cache.
 */
export function createE235Car(index: number, total = 11): THREE.Group {
  const car = new THREE.Group()
  car.name = `E235-0-Yamanote-car-${index + 1}`
  car.userData = { model: 'E235-0', scale: TRAIN_SCALE, carNumber: total - index, length: CAR_LENGTH, bogieDistance: BOGIE_DISTANCE }
  const cab = index === 0 || index === total - 1
  const cabDirection = index === 0 ? 1 : -1
  const silver = new THREE.MeshStandardMaterial({ color: '#bfc7ca', metalness: 0.72, roughness: 0.35 })
  const brightSilver = new THREE.MeshStandardMaterial({ color: '#d1d6d8', metalness: 0.78, roughness: 0.26 })
  const roofMaterial = new THREE.MeshStandardMaterial({ color: '#afb5b6', metalness: 0.45, roughness: 0.62 })
  const dark = new THREE.MeshStandardMaterial({ color: '#263137', metalness: 0.3, roughness: 0.73 })
  const wheel = new THREE.MeshStandardMaterial({ color: '#596368', metalness: 0.8, roughness: 0.39 })
  const glass = new THREE.MeshPhysicalMaterial({ color: '#233e51', metalness: 0.18, roughness: 0.2, clearcoat: 0.9, clearcoatRoughness: 0.13 })
  const blackFrame = new THREE.MeshStandardMaterial({ color: '#283039', metalness: 0.25, roughness: 0.42 })
  const doorMap = greenDoorTexture()
  const doorMaterial = new THREE.MeshStandardMaterial({ color: doorMap ? '#ffffff' : '#91c434', map: doorMap ?? null, metalness: 0.18, roughness: 0.43 })
  const green = new THREE.MeshStandardMaterial({ color: '#91c434', metalness: 0.15, roughness: 0.38 })

  car.add(shell([
    [-8.9, 5.3], [-9.78, 6.8], [-9.78, 21.45], [-9.2, 23.05],
    [-7.4, 24.65], [7.4, 24.65], [9.2, 23.05], [9.78, 21.45], [9.78, 6.8], [8.9, 5.3],
  ], CAR_LENGTH, silver, 'stainless-steel-body'))
  car.add(shell([
    [-9.1, 22.85], [-8.65, 23.75], [-7.2, 24.65], [-4.2, 25.05],
    [4.2, 25.05], [7.2, 24.65], [8.65, 23.75], [9.1, 22.85],
  ], CAR_LENGTH - 1.1, roofMaterial, 'rounded-roof'))

  const details: BoxInstance[] = []
  const frames: BoxInstance[] = []
  const windows: BoxInstance[] = []
  const doors: BoxInstance[] = []
  const reflection: BoxInstance[] = []
  for (const side of [-1, 1]) {
    // E235 doors are vertical green panels, unlike the E231's horizontal green stripe.
    for (const x of DOOR_POSITIONS) {
      frames.push({ position: [x, 14.55, side * 9.81], scale: [9.25, 17.2, 0.2] })
      doors.push({ position: [x, 14.55, side * 9.97], scale: [8.75, 16.65, 0.09] })
      for (const offset of [-2.16, 2.16]) {
        frames.push({ position: [x + offset, 17.43, side * 10.04], scale: [3.6, 7.35, 0.07] })
        windows.push({ position: [x + offset, 17.43, side * 10.1], scale: [3.04, 6.72, 0.05] })
        reflection.push({ position: [x + offset, 19.96, side * 10.135], scale: [2.69, 0.24, 0.025] })
      }
      details.push({ position: [x, 5.98, side * 9.96], scale: [9.4, 0.45, 0.7] })
    }
    for (const x of [-30.15, 0, 30.15]) {
      frames.push({ position: [x, 17.44, side * 9.84], scale: [18.3, 7.8, 0.16] })
      for (const offset of [-4.45, 4.45]) {
        windows.push({ position: [x + offset, 17.44, side * 9.96], scale: [8.5, 7.05, 0.05] })
        reflection.push({ position: [x + offset, 20.03, side * 10.005], scale: [7.83, 0.29, 0.03] })
      }
    }
    for (const end of [-1, 1]) {
      const cabEnd = (index === 0 && end === 1) || (index === total - 1 && end === -1)
      const width = cabEnd ? 5.9 : 8.1
      const x = end * (cabEnd ? 60.55 : 58.8)
      frames.push({ position: [x, cabEnd ? 18.1 : 17.44, side * 9.84], scale: [width + 0.58, 7.8, 0.16] })
      windows.push({ position: [x, cabEnd ? 18.1 : 17.44, side * 9.96], scale: [width, 7.05, 0.05] })
      if (cabEnd) {
        details.push({ position: [end * 54.7, 12.9, side * 9.82], scale: [0.11, 12.8, 0.1] })
        details.push({ position: [end * 57.1, 12.9, side * 9.82], scale: [0.11, 12.8, 0.1] })
      }
    }
    // Subtle stainless corrugations, sill, and lower side skirt.
    for (const y of [7.45, 8.15, 8.85, 12.35]) {
      details.push({ position: [0, y, side * 9.835], scale: [CAR_LENGTH - 1.8, 0.12, 0.06] })
    }
    details.push({ position: [0, 23.07, side * 9.235], scale: [CAR_LENGTH - 1, 0.19, 0.13] })
  }
  instancedBoxes(car, blackFrame, frames, 'window-and-door-gaskets')
  instancedBoxes(car, doorMaterial, doors, 'four-green-doors-per-side')
  instancedBoxes(car, glass, windows, 'tinted-passenger-and-door-windows')
  instancedBoxes(car, brightSilver, details, 'stainless-sills-and-corrugations')
  const highlight = new THREE.MeshStandardMaterial({ color: '#688b9e', metalness: 0.2, roughness: 0.34 })
  instancedBoxes(car, highlight, reflection, 'window-reflections')

  const sideMap = sideDisplayTexture(index)
  const sideDisplay = new THREE.MeshBasicMaterial({ map: sideMap ?? null, color: sideMap ? '#ffffff' : '#182624' })
  instancedBoxes(car, sideDisplay, [-1, 1].map(side => ({
    position: [29.7, 22.01, side * 9.7] as [number, number, number],
    scale: [12.6, 1.85, 0.08] as [number, number, number],
  })), 'side-destination-and-car-number')
  const sideMark = jrSideTexture()
  const sideMarkMaterial = new THREE.MeshStandardMaterial({ color: sideMark ? '#ffffff' : '#91c434', map: sideMark ?? null, transparent: !!sideMark, roughness: 0.58 })
  instancedBoxes(car, sideMarkMaterial, [-1, 1].map(side => ({
    position: [-57.8, 10.8, side * 9.875] as [number, number, number],
    scale: [3.8, 1.3, 0.08] as [number, number, number],
  })), 'small-side-markings')

  instancedBoxes(car, dark, [
    { position: [0, 5.3, 0], scale: [CAR_LENGTH - 4, 1.65, 15.7] },
    { position: [-15, 3.2, 0], scale: [17, 3.4, 10.1] },
    { position: [6.6, 3.55, 0], scale: [20, 2.7, 10.8] },
    { position: [28, 3.5, 0], scale: [10.5, 3.3, 9.4] },
    { position: [-31, 3.7, 0], scale: [8.2, 2.6, 9.5] },
  ], 'underfloor-equipment')
  addBogie(car, BOGIE_DISTANCE, wheel, dark, silver, 'bogie-front')
  addBogie(car, -BOGIE_DISTANCE, wheel, dark, silver, 'bogie-rear')

  // AU737 rooftop air conditioner: twin dark grille fields in a light housing.
  instancedBoxes(car, roofMaterial, [
    { position: [7.7, 26.65, 0], scale: [36.2, 3.1, 12.25] },
  ], 'AU737-air-conditioner')
  const ventBoxes: BoxInstance[] = [
    { position: [-2.7, 28.22, 0], scale: [12.5, 0.12, 9.3] },
    { position: [18.0, 28.22, 0], scale: [12.5, 0.12, 9.3] },
  ]
  instancedBoxes(car, dark, ventBoxes, 'AC-grilles')
  const ribs: BoxInstance[] = []
  for (const center of [-2.7, 18]) {
    for (let rib = -5; rib <= 5; rib += 1) {
      ribs.push({ position: [center + rib * 1.06, 28.3, 0], scale: [0.2, 0.12, 9.2] })
    }
  }
  instancedBoxes(car, silver, ribs, 'AC-louvres')
  instancedBoxes(car, roofMaterial, [
    { position: [-52, 25.45, 0], scale: [3.5, 0.8, 3.5] },
    { position: [52, 25.45, 0], scale: [3.5, 0.8, 3.5] },
  ], 'antenna-pedestals')
  if ([2, 5, 8].includes(index)) addPantograph(car, dark)
  if (cab) {
    instancedBoxes(car, roofMaterial, [{ position: [cabDirection * 55.3, 26.5, 0], scale: [3.3, 2.8, 1.7] }], 'cab-radio-antenna')
  }

  for (const end of [-1, 1]) {
    const cabEnd = (index === 0 && end === 1) || (index === total - 1 && end === -1)
    const endName = end === 1 ? 'front' : 'rear'
    const couplingAnchor = new THREE.Object3D()
    couplingAnchor.name = `coupling-${endName}`
    couplingAnchor.position.set(end * CAR_LENGTH / 2, COUPLING_HEIGHT, 0)
    couplingAnchor.userData.cab = cabEnd
    car.add(couplingAnchor)
    if (cabEnd) {
      const tail = end === -1
      instancedBoxes(car, green, [-1, 1].map(side => ({
        position: [end * (CAR_LENGTH / 2 - 1.08), 14.82, side * 9.84] as [number, number, number],
        scale: [2.05, 16.3, 0.12] as [number, number, number],
      })), 'green-cab-side-wrap')
      const faceMap = faceTexture(tail)
      const faceMaterial = new THREE.MeshStandardMaterial({ map: faceMap ?? null, color: faceMap ? '#ffffff' : '#91c434', roughness: 0.53, metalness: 0.08 })
      const face = new THREE.Mesh(frontGeometry(), faceMaterial)
      face.name = 'E235-green-front-and-destination'
      face.position.set(end * (CAR_LENGTH / 2 + 0.07), 15.05, 0)
      face.rotation.y = end * Math.PI / 2
      car.add(face)
      const lamps = new THREE.MeshStandardMaterial({
        color: tail ? '#d52321' : '#ffffe4',
        emissive: tail ? '#ee2115' : '#fffbc5',
        emissiveIntensity: 0.9,
        roughness: 0.18,
      })
      instancedBoxes(car, lamps, [-1, 1].map(side => ({
        position: [end * (CAR_LENGTH / 2 + 0.15), tail ? 10 : 21.7, side * 7.4] as [number, number, number],
        scale: [0.13, tail ? 0.5 : 0.65, tail ? 1.1 : 1.65] as [number, number, number],
      })), tail ? 'red-tail-lights' : 'white-headlights')
      instancedBoxes(car, silver, [{ position: [end * (CAR_LENGTH / 2 - 0.3), 4.75, 0], scale: [1.9, 3.1, 14.1] }], 'cab-front-skirt')
    } else {
      const gangwayAnchor = new THREE.Object3D()
      gangwayAnchor.name = `gangway-${endName}`
      gangwayAnchor.position.set(end * CAR_LENGTH / 2, GANGWAY_HEIGHT, 0)
      car.add(gangwayAnchor)
      instancedBoxes(car, dark, [{ position: [end * (CAR_LENGTH / 2 + 0.12), GANGWAY_HEIGHT, 0], scale: [0.35, 14, 5.7] }], `rubber-gangway-${endName}`)
      instancedBoxes(car, glass, [{ position: [end * (CAR_LENGTH / 2 + 0.31), 17.2, 0], scale: [0.08, 6.9, 3.1] }], `gangway-door-window-${endName}`)
    }
    instancedBoxes(car, dark, [{
      position: [end * (CAR_LENGTH / 2 + (cabEnd ? 0.8 : -0.35)), COUPLING_HEIGHT, 0],
      scale: [cabEnd ? 3.15 : 1.2, 1.25, 2.1],
    }], cabEnd ? 'cab-coupler' : `coupler-mount-${endName}`)
  }
  return car
}

/** Keep the original Yamanote model intact; high-speed series have their own shells. */
export function createTrainCar(index: number, total = 11, trainType: TrainType = 'e235'): THREE.Group {
  return trainType === 'e235' ? createE235Car(index, total) : createShinkansenCar(index, total, trainType)
}

/** Broader flexible diaphragms fill the high-speed train's enclosed body ends. */
export function createTrainConnection(trainType: TrainType = 'e235'): THREE.Group {
  const connection = createE235Connection()
  if (trainType !== 'e235') {
    const spec = getTrainSpec(trainType)
    connection.userData.gangwayHalfHeight = (spec.height - 4.8) / 2 - .35
    connection.userData.gangwayHalfWidth = spec.width / 2 - .65
    const bellows = connection.getObjectByName('flexible-gangway-bellows') as THREE.Mesh
    const material = bellows.material as THREE.MeshStandardMaterial
    material.color.set('#9ba2a2'); material.roughness = .75
  }
  return connection
}

/** Dispose only after all cars in this subtree have been removed from the scene. */
export function disposeTrainModel(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points)) return
    geometries.add(object.geometry)
    const collection = Array.isArray(object.material) ? object.material : [object.material]
    collection.forEach(material => {
      materials.add(material)
      Object.values(material).forEach(value => {
        if (value instanceof THREE.Texture) textures.add(value)
      })
    })
    if (object instanceof THREE.InstancedMesh) object.dispose()
  })
  geometries.forEach(geometry => geometry.dispose())
  materials.forEach(material => material.dispose())
  textures.forEach(texture => texture.dispose())
}
