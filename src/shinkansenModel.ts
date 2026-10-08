import * as THREE from 'three'
import { getTrainCarSpec } from './trains'
import type { TrainType, TrainSpec } from './trains'
import { addShinkansenRoof } from './shinkansenRoof'

type ShinkansenType = Exclude<TrainType, 'e235'>
type BoxPart = { position: [number, number, number]; size: [number, number, number]; rotation?: THREE.Euler }
const FLOOR = 4.8
const TAU = Math.PI * 2
const SECTION_POWER = 0.67

/** Original procedural surfaces, using JR East and KATO exterior photographs.
 * Model dimensions and their limits are documented in docs/shinkansen-trains.md.
 * The nose is a smooth loft of rounded cross sections, not a scaled cone.
 */
const NOSE_SECTIONS: Record<ShinkansenType, [number, number, number, number][]> = {
  // Progress, half-width fraction, roof fraction, belly fraction. E5's broad,
  // low hood stays wide far ahead of its cab, giving its characteristic duckbill.
  e5: [[0, 1, 1, 0], [.14, 1, .985, -.005], [.27, .985, .87, -.015], [.40, .96, .64, -.006], [.59, .92, .46, 0], [.77, .85, .415, .015], [.91, .65, .365, .10], [1, 0, .23, .23]],
  e6: [[0, 1, 1, 0], [.13, 1, .985, 0], [.27, .96, .88, -.004], [.44, .90, .64, .005], [.64, .78, .46, .01], [.82, .60, .395, .035], [.94, .35, .345, .16], [1, 0, .25, .25]],
  e7: [[0, 1, 1, 0], [.17, 1, .985, 0], [.35, .98, .90, 0], [.53, .89, .69, .012], [.72, .76, .435, .025], [.88, .53, .255, .035], [1, 0, .145, .145]],
}

function boxes(parent: THREE.Object3D, material: THREE.Material, parts: BoxPart[], name: string) {
  if (!parts.length) return
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, parts.length)
  mesh.name = name
  const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion()
  parts.forEach((part, index) => {
    rotation.setFromEuler(part.rotation ?? new THREE.Euler())
    matrix.compose(new THREE.Vector3(...part.position), rotation, new THREE.Vector3(...part.size))
    mesh.setMatrixAt(index, matrix)
  })
  mesh.castShadow = mesh.receiveShadow = true
  parent.add(mesh)
}

function interpolate(table: [number, number, number, number][], t: number, column: 1 | 2 | 3) {
  const clamped = THREE.MathUtils.clamp(t, 0, 1)
  let segment = table.findIndex((point, index) => index < table.length - 1 && clamped <= table[index + 1][0])
  if (segment < 0) segment = table.length - 2
  const first = table[segment], second = table[segment + 1]
  const u = (clamped - first[0]) / (second[0] - first[0])
  const previous = table[Math.max(0, segment - 1)], next = table[Math.min(table.length - 1, segment + 2)]
  const firstSlope = (second[column] - previous[column]) / Math.max(1e-6, second[0] - previous[0])
  const secondSlope = (next[column] - first[column]) / Math.max(1e-6, next[0] - first[0])
  const span = second[0] - first[0]
  const value = (2 * u ** 3 - 3 * u ** 2 + 1) * first[column] + (u ** 3 - 2 * u ** 2 + u) * firstSlope * span
    + (-2 * u ** 3 + 3 * u ** 2) * second[column] + (u ** 3 - u ** 2) * secondSlope * span
  const bounded = THREE.MathUtils.clamp(value, Math.min(first[column], second[column]), Math.max(first[column], second[column]))
  if (segment !== table.length - 2) return bounded
  // A linear closure makes a paper-thin triangular point. The final cap closes
  // elliptically, retaining a broad rounded chin and vertical front tangent.
  const radius = Math.sqrt(1 - u)
  const center = THREE.MathUtils.lerp((first[2] + first[3]) / 2, second[2], THREE.MathUtils.smoothstep(u, 0, 1))
  const ellipse = column === 1 ? first[1] * radius : center + (column === 2 ? 1 : -1) * (first[2] - first[3]) / 2 * radius
  return THREE.MathUtils.lerp(bounded, ellipse, THREE.MathUtils.smoothstep(u, 0, .25))
}

function signedPower(value: number) { return Math.sign(value) * Math.abs(value) ** SECTION_POWER }

export function shinkansenSurface(spec: TrainSpec, type: ShinkansenType, x: number, theta: number): THREE.Vector3 {
  const noseStart = spec.length / 2 - spec.noseLength
  const t = spec.noseLength ? THREE.MathUtils.clamp((x - noseStart) / spec.noseLength, 0, 1) : 0
  const span = spec.height - FLOOR
  const width = spec.width / 2 * (spec.noseLength && x > noseStart ? interpolate(NOSE_SECTIONS[type], t, 1) : 1)
  const top = FLOOR + span * (spec.noseLength && x > noseStart ? interpolate(NOSE_SECTIONS[type], t, 2) : 1)
  const bottom = FLOOR + span * (spec.noseLength && x > noseStart ? interpolate(NOSE_SECTIONS[type], t, 3) : 0)
  return new THREE.Vector3(x, (top + bottom) / 2 + (top - bottom) / 2 * signedPower(Math.sin(theta)), width * signedPower(Math.cos(theta)))
}

function surfaceNormal(spec: TrainSpec, type: ShinkansenType, x: number, theta: number) {
  const dx = shinkansenSurface(spec, type, Math.min(spec.length / 2 - .001, x + .01), theta)
    .sub(shinkansenSurface(spec, type, Math.max(-spec.length / 2, x - .01), theta))
  const across = shinkansenSurface(spec, type, x, theta + .001).sub(shinkansenSurface(spec, type, x, theta - .001))
  const normal = dx.cross(across).normalize()
  return normal.lengthSq() > .1 ? normal : new THREE.Vector3(1, 0, 0)
}

/** A surface ribbon also paints the nose: its borders follow the actual loft. */
function surfaceGrid(
  spec: TrainSpec, type: ShinkansenType, xs: number[],
  firstTheta: (x: number) => number, secondTheta: (x: number) => number,
  columns: number, offset = 0, caps = false,
) {
  const positions: number[] = [], normals: number[] = [], uv: number[] = [], indices: number[] = []
  xs.forEach((x, row) => {
    for (let column = 0; column <= columns; column++) {
      const t = column / columns, theta = firstTheta(x) + (secondTheta(x) - firstTheta(x)) * t
      const normal = surfaceNormal(spec, type, x, theta)
      const point = shinkansenSurface(spec, type, x, theta).addScaledVector(normal, offset)
      positions.push(point.x, point.y, point.z); normals.push(normal.x, normal.y, normal.z); uv.push(row / (xs.length - 1), t)
    }
  })
  for (let row = 0; row < xs.length - 1; row++) for (let column = 0; column < columns; column++) {
    const a = row * (columns + 1) + column, b = a + 1, c = a + columns + 1, d = c + 1
    indices.push(a, c, b, b, c, d)
  }
  if (caps) {
    for (const row of [0, xs.length - 1]) {
      const first = row * (columns + 1), center = positions.length / 3
      const y = (positions[first * 3 + 1] + positions[(first + Math.floor(columns / 2)) * 3 + 1]) / 2
      positions.push(xs[row], y, 0); normals.push(row ? 1 : -1, 0, 0); uv.push(row ? 1 : 0, .5)
      for (let column = 0; column < columns; column++) {
        if (row) indices.push(center, first + column, first + column + 1)
        else indices.push(center, first + column + 1, first + column)
      }
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geometry.setIndex(indices)
  return geometry
}

function mesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, name: string) {
  const object = new THREE.Mesh(geometry, material)
  object.name = name; object.castShadow = object.receiveShadow = true; parent.add(object)
  return object
}

function roofCut(type: ShinkansenType, spec: TrainSpec, x: number) {
  const t = spec.noseLength ? THREE.MathUtils.clamp((x - (spec.length / 2 - spec.noseLength)) / spec.noseLength, 0, 1) : 0
  if (type === 'e5') return -.15
  if (type === 'e6') return .81 - .93 * THREE.MathUtils.smoothstep(t, .05, .54)
  return 1.02 - .89 * THREE.MathUtils.smoothstep(t, .02, .82)
}

function bodySideZ(spec: TrainSpec, y: number) {
  const normalized = THREE.MathUtils.clamp((y - (spec.height + FLOOR) / 2) / ((spec.height - FLOOR) / 2), -.9999, .9999)
  const sine = Math.sign(normalized) * Math.abs(normalized) ** (1 / SECTION_POWER)
  return spec.width / 2 * (Math.sqrt(1 - sine * sine)) ** SECTION_POWER
}

function roundedShape(width: number, height: number, radius: number) {
  const x = -width / 2, y = -height / 2, shape = new THREE.Shape()
  shape.moveTo(x + radius, y); shape.lineTo(x + width - radius, y)
  shape.quadraticCurveTo(x + width, y, x + width, y + radius)
  shape.lineTo(x + width, y + height - radius); shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
  shape.lineTo(x + radius, y + height); shape.quadraticCurveTo(x, y + height, x, y + height - radius)
  shape.lineTo(x, y + radius); shape.quadraticCurveTo(x, y, x + radius, y)
  return shape
}

function sidePanels(parent: THREE.Object3D, spec: TrainSpec, xs: number[], width: number, height: number, y: number, offset: number, material: THREE.Material, name: string) {
  if (!xs.length) return
  // ShapeGeometry triangulates only its border; on a convex body those large
  // chords disappear beneath the paint. Interior rows follow the same rounded
  // side wall as the shell, keeping the complete glass/gasket face visible.
  const rows = 16, columns = 4, radius = Math.min(.5, width / 2)
  const positions: number[] = [], indices: number[] = []
  for (let row = 0; row <= rows; row++) {
    const localY = -height / 2 + height * row / rows
    const cornerDistance = Math.max(0, Math.abs(localY) - (height / 2 - radius))
    const halfWidth = width / 2 - radius + Math.sqrt(Math.max(0, radius * radius - cornerDistance * cornerDistance))
    for (let column = 0; column <= columns; column++) {
      const vertexY = localY + y
      positions.push(-halfWidth + 2 * halfWidth * column / columns, vertexY, bodySideZ(spec, vertexY) + offset)
    }
  }
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const a = row * (columns + 1) + column, b = a + 1, c = a + columns + 1, d = c + 1
    indices.push(a, b, c, b, d, c)
  }
  const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)).setIndex(indices)
  geometry.computeVertexNormals()
  const object = new THREE.InstancedMesh(geometry, material, xs.length * 2)
  object.name = name
  const matrix = new THREE.Matrix4(), orientation = new THREE.Quaternion(), scale = new THREE.Vector3(1, 1, 1)
  for (let side = 0; side < 2; side++) for (let index = 0; index < xs.length; index++) {
    orientation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), side ? Math.PI : 0)
    matrix.compose(new THREE.Vector3(xs[index], 0, 0), orientation, scale)
    object.setMatrixAt(side * xs.length + index, matrix)
  }
  parent.add(object)
}

function addDoorOutlines(parent: THREE.Object3D, spec: TrainSpec, doors: number[], material: THREE.Material) {
  const vertices: number[] = []
  const outline = roundedShape(4.6, 13.7, .55).getPoints(5)
  for (const x of doors) for (const side of [-1, 1]) {
    outline.forEach((point, index) => {
      const next = outline[(index + 1) % outline.length]
      for (const end of [point, next]) {
        const y = end.y + (spec.height + FLOOR) / 2
        vertices.push(x + end.x, y, side * (bodySideZ(spec, y) + .055))
      }
    })
  }
  const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  const object = new THREE.LineSegments(geometry, material)
  object.name = 'flush-single-leaf-door-seams'; parent.add(object)
}

function patch(parent: THREE.Object3D, spec: TrainSpec, type: ShinkansenType, start: number, end: number, halfAngle: number, material: THREE.Material, name: string) {
  const xs = Array.from({ length: 13 }, (_, index) => start + (end - start) * index / 12)
  const mid = (start + end) / 2
  const width = (x: number) => halfAngle * (.72 + .28 * Math.sqrt(Math.max(0, 1 - ((x - mid) / ((end - start) / 2)) ** 2)))
  return mesh(parent, surfaceGrid(spec, type, xs, x => Math.PI / 2 - width(x), x => Math.PI / 2 + width(x), 16, .07), material, name)
}

function noseTriangle(parent: THREE.Object3D, spec: TrainSpec, type: ShinkansenType, coordinates: [number, number][], side: number, material: THREE.Material, name: string) {
  const noseStart = spec.length / 2 - spec.noseLength
  const positions: number[] = [], normals: number[] = [], indices: number[] = []
  const subdivisions = 10, rows: number[][] = []
  for (let row = 0; row <= subdivisions; row++) {
    rows.push([])
    for (let column = 0; column <= subdivisions - row; column++) {
      const weights = [1 - (row + column) / subdivisions, row / subdivisions, column / subdivisions]
      const t = coordinates.reduce((sum, p, index) => sum + p[0] * weights[index], 0)
      const theta = coordinates.reduce((sum, p, index) => sum + p[1] * weights[index], 0)
      const angle = side === 1 ? theta : Math.PI - theta, x = noseStart + t * spec.noseLength
      const normal = surfaceNormal(spec, type, x, angle)
      const point = shinkansenSurface(spec, type, x, angle).addScaledVector(normal, .10)
      rows[row].push(positions.length / 3)
      positions.push(point.x, point.y, point.z); normals.push(normal.x, normal.y, normal.z)
    }
  }
  const triangle = (a: number, b: number, c: number) => indices.push(...(side === 1 ? [a, b, c] : [a, c, b]))
  for (let row = 0; row < subdivisions; row++) for (let column = 0; column < subdivisions - row; column++) {
    triangle(rows[row][column], rows[row + 1][column], rows[row][column + 1])
    if (column < subdivisions - row - 1) triangle(rows[row][column + 1], rows[row + 1][column], rows[row + 1][column + 1])
  }
  const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)).setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3)).setIndex(indices)
  return mesh(parent, geometry, material, name)
}

function addNoseBogieFairing(parent: THREE.Object3D, spec: TrainSpec, type: ShinkansenType, material: THREE.Material) {
  const positions: number[] = [], indices: number[] = []
  for (const side of [-1, 1]) {
    const first = positions.length / 3
    for (let step = 0; step <= 16; step++) {
      const fraction = step / 16, x = spec.bogieOffset - 12 + fraction * 24
      const attachment = shinkansenSurface(spec, type, x, side === 1 ? -.63 : Math.PI + .63)
      const width = Math.max(6.65, shinkansenSurface(spec, type, x, 0).z * .97)
      const lower = 2.95 + 1.30 * Math.abs(2 * fraction - 1) ** 4
      positions.push(x, lower, side * width, x, attachment.y + .03, attachment.z + side * .045)
    }
    for (let step = 0; step < 16; step++) {
      const a = first + step * 2, b = a + 1, c = a + 2, d = a + 3
      indices.push(...(side === 1 ? [a, c, b, b, c, d] : [a, b, c, b, d, c]))
    }
  }
  const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)).setIndex(indices)
  geometry.computeVertexNormals()
  mesh(parent, geometry, material, 'curved-nose-bogie-upper-fairing')
}

function addBogies(car: THREE.Group, spec: TrainSpec, wheel: THREE.Material, dark: THREE.Material, silver: THREE.Material) {
  for (const end of [-1, 1]) {
    const bogie = new THREE.Group(); bogie.name = end === 1 ? 'bogie-front' : 'bogie-rear'; bogie.position.x = end * spec.bogieOffset
    boxes(bogie, dark, [
      { position: [0, 2.8, 0], size: [15.5, 2.1, 8.2] },
      ...[-1, 1].map(side => ({ position: [0, 2.7, side * 5.7] as [number, number, number], size: [16.8, 1.3, 1.3] as [number, number, number] })),
    ], 'bogie-air-suspension-and-frame')
    const geometry = new THREE.CylinderGeometry(2.25, 2.25, .9, 14); geometry.rotateX(Math.PI / 2)
    const wheels = new THREE.InstancedMesh(geometry, wheel, 4); wheels.name = '9mm-gauge-wheels'
    const matrix = new THREE.Matrix4(); let index = 0
    for (const x of [-6.2, 6.2]) for (const z of [-4.95, 4.95]) { matrix.makeTranslation(x, 2.25, z); wheels.setMatrixAt(index++, matrix) }
    bogie.add(wheels)
    boxes(bogie, silver, [-6.2, 6.2].flatMap(x => [-1, 1].map(side => ({
      position: [x, 2.7, side * 6.3] as [number, number, number], size: [2.1, 1.8, .9] as [number, number, number],
    }))), 'bearing-caps')
    car.add(bogie)
  }
}

/** Both outside cars retain a cab even in a shortened play formation. */
export function createShinkansenCar(index: number, total: number, type: ShinkansenType): THREE.Group {
  const spec = getTrainCarSpec(type, index, total)
  const cab = index === 0 || index === total - 1, noseDirection = cab ? index === 0 ? 1 : -1 : 0
  const car = new THREE.Group(); car.name = `${spec.model}-Shinkansen-car-${index + 1}`
  car.userData = { model: spec.model, trainType: type, scale: spec.scale, carNumber: total - index, length: spec.length, bogieOffset: spec.bogieOffset, bogieDistance: spec.bogieOffset, cab, noseDirection, noseLength: spec.noseLength }
  const exterior = new THREE.Group(); exterior.name = 'smooth-aerodynamic-exterior'; exterior.rotation.y = noseDirection === -1 ? Math.PI : 0; car.add(exterior)
  const pearl = new THREE.MeshPhysicalMaterial({ color: spec.colors.secondary, metalness: type === 'e7' ? .04 : .24, roughness: .31, clearcoat: .7, clearcoatRoughness: .24 })
  const primary = new THREE.MeshPhysicalMaterial({ color: spec.colors.primary, metalness: type === 'e7' ? .06 : .32, roughness: .28, clearcoat: .9, clearcoatRoughness: .19 })
  const stripe = new THREE.MeshStandardMaterial({ color: spec.colors.stripe, metalness: type === 'e7' ? .55 : .16, roughness: .32 })
  const silver = new THREE.MeshStandardMaterial({ color: '#b3bac0', metalness: .66, roughness: .38 })
  const dark = new THREE.MeshStandardMaterial({ color: '#303a42', metalness: .3, roughness: .66 })
  const glass = new THREE.MeshPhysicalMaterial({ color: '#112a38', metalness: .25, roughness: .16, clearcoat: 1, clearcoatRoughness: .10, side: THREE.DoubleSide })
  const frame = new THREE.MeshStandardMaterial({ color: '#313b40', roughness: .62, side: THREE.DoubleSide })
  const halfLength = spec.length / 2, noseStart = halfLength - spec.noseLength
  const xs = cab ? [
    ...Array.from({ length: 10 }, (_, i) => -halfLength + (noseStart + halfLength) * i / 10),
    ...Array.from({ length: 49 }, (_, i) => noseStart + spec.noseLength * i / 48),
  ] : Array.from({ length: 13 }, (_, i) => -halfLength + spec.length * i / 12)
  mesh(exterior, surfaceGrid(spec, type, xs, () => 0, () => TAU, 56, 0, true), pearl, 'continuous-rounded-body-and-sculpted-nose')
  mesh(exterior, surfaceGrid(spec, type, xs, x => roofCut(type, spec, x), x => Math.PI - roofCut(type, spec, x), 32, .028), primary, type === 'e5' ? 'emerald-green-upper-body-and-duckbill' : type === 'e6' ? 'carmine-red-roof-and-pointed-nose' : 'blue-roof-and-central-nose')
  if (cab) {
    const noseXs = xs.filter(x => x >= noseStart)
    const chinCut = (x: number) => {
      const t = (x - noseStart) / spec.noseLength
      const frontCut = type === 'e7' ? .31 : Math.max(.10, -roofCut(type, spec, x))
      return THREE.MathUtils.lerp(1.32, frontCut, THREE.MathUtils.smoothstep(t, .03, .46))
    }
    mesh(exterior, surfaceGrid(spec, type, noseXs, x => Math.PI + chinCut(x), x => TAU - chinCut(x), 30, .037), type === 'e7' ? pearl : silver, type === 'e7' ? 'rounded-ivory-nose-chin-and-coupler-cover' : 'rounded-silver-nose-chin-and-coupler-cover')
    addNoseBogieFairing(exterior, spec, type, type === 'e7' ? pearl : silver)
  }

  if (type === 'e5') {
    for (const side of [1, -1]) {
      mesh(exterior, surfaceGrid(spec, type, xs, x => side === 1 ? roofCut(type, spec, x) - .046 : Math.PI - roofCut(type, spec, x), x => side === 1 ? roofCut(type, spec, x) + .014 : Math.PI - roofCut(type, spec, x) + .046, 2, .055), stripe, 'pink-belt-line')
    }
  } else if (type === 'e6') {
    // E6's sides stay white; a silver belt below its windows and a full skirt
    // distinguish it from a generic red repaint of the green E5.
    const sideXs = xs.filter(x => x <= noseStart + (cab ? spec.noseLength * .20 : 0))
    for (const side of [1, -1]) {
      const theta = side === 1 ? -.09 : Math.PI + .09
      mesh(exterior, surfaceGrid(spec, type, sideXs, () => theta - .045, () => theta + .045, 2, .04), stripe, 'silver-side-belt-below-windows')
    }
  } else {
    const bandStart = cab ? noseStart - 16 : halfLength
    const bandXs = [...xs.filter(x => x < bandStart), bandStart, ...(cab ? Array.from({ length: 40 }, (_, i) => bandStart + (halfLength - bandStart) * (i + 1) / 40) : [])]
    for (const side of [1, -1]) {
      // E7 has a second, narrow copper edge along the blue roof shoulder.
      // Continue that border around the cab, where it meets the wider nose belt.
      const shoulderXs = xs.filter(x => !cab || x <= noseStart)
      mesh(exterior, surfaceGrid(spec, type, shoulderXs,
        x => side === 1 ? roofCut(type, spec, x) - .085 : Math.PI - roofCut(type, spec, x) - .008,
        x => side === 1 ? roofCut(type, spec, x) + .008 : Math.PI - roofCut(type, spec, x) + .085,
        2, .066), stripe, 'copper-upper-roof-shoulder-edging')
      const center = (x: number) => {
        const angle = x <= bandStart ? -.21 : x < noseStart ? -.21 + 1.23 * THREE.MathUtils.smoothstep(x, bandStart, noseStart) : roofCut(type, spec, x)
        return side === 1 ? angle : Math.PI - angle
      }
      const halfWidth = (x: number) => .045 + (cab ? .075 * THREE.MathUtils.smoothstep(x, noseStart, noseStart + spec.noseLength * .28) : 0)
      mesh(exterior, surfaceGrid(spec, type, bandXs, x => center(x) - halfWidth(x), x => center(x) + halfWidth(x), 4, .058), stripe, 'copper-belt-rising-around-cab-and-blue-nose')
      const blueXs = xs.filter(x => x <= bandStart)
      const theta = side === 1 ? -.305 : Math.PI + .305
      mesh(exterior, surfaceGrid(spec, type, blueXs, () => theta - .018, () => theta + .018, 2, .057), primary, 'thin-blue-line-below-copper-belt')
    }
  }

  // Full side skirts and the many narrow inspection/louvre panels are present
  // on all three high-speed trains. Wheels still sit on the 9 mm rail gauge.
  const bodyEnd = cab ? noseStart - 1 : halfLength - 1
  const equipmentCenter = (-halfLength + bodyEnd) / 2, equipmentLength = bodyEnd + halfLength - 2
  const skirtMaterial = type === 'e5' || type === 'e6' ? silver : pearl
  const skirt: BoxPart[] = [], panels: BoxPart[] = []
  for (const side of [-1, 1]) {
    skirt.push({ position: [equipmentCenter, 4.25, side * (spec.width / 2 - 1.4)], size: [equipmentLength, 2.25, .5] })
    for (let x = -halfLength + 8; x < bodyEnd - 5; x += 10) {
      panels.push({ position: [x, 6.4, side * (bodySideZ(spec, 6.4) + .065)], size: [7.8, .09, .1] })
      for (const y of [5.7, 6.0, 6.3, 6.6, 6.9]) panels.push({ position: [x, y, side * (bodySideZ(spec, y) + .07)], size: [4.6, .075, .06] })
    }
  }
  boxes(exterior, skirtMaterial, skirt, 'continuous-underbody-aerodynamic-skirts')
  boxes(exterior, silver, panels, 'skirt-louvres-and-service-panel-seams')
  boxes(exterior, dark, [{ position: [equipmentCenter, 4.1, 0], size: [equipmentLength, 2.7, spec.width - 4.7] }], 'enclosed-underfloor-equipment')

  const backDoor = -halfLength + 9, frontDoor = cab ? noseStart - 7 : halfLength - 9
  const doors = [backDoor, frontDoor]
  const windows: number[] = []
  const firstWindow = backDoor + 9, lastWindow = frontDoor - 9
  const windowCount = Math.max(2, Math.floor((lastWindow - firstWindow) / 6.9) + 1)
  for (let i = 0; i < windowCount; i++) windows.push(firstWindow + (lastWindow - firstWindow) * i / Math.max(1, windowCount - 1))
  const windowHeight = type === 'e6' ? 3.5 : 3.45, windowY = spec.height - 6.25
  sidePanels(exterior, spec, windows, 4.45, windowHeight + .45, windowY, .07, frame, 'rounded-passenger-window-gaskets')
  sidePanels(exterior, spec, windows, 3.96, windowHeight, windowY, .09, glass, 'small-individual-passenger-windows')
  sidePanels(exterior, spec, doors, 1.65, 3.8, spec.height - 4.1, .09, frame, 'single-door-window-gaskets')
  sidePanels(exterior, spec, doors, 1.30, 3.43, spec.height - 4.1, .11, glass, 'single-door-windows')
  addDoorOutlines(exterior, spec, doors, new THREE.LineBasicMaterial({ color: '#657578', transparent: true, opacity: .65 }))
  boxes(exterior, silver, doors.flatMap(x => [-1, 1].map(side => ({ position: [x + 1.2, 12.8, side * (bodySideZ(spec, 12.8) + .14)] as [number, number, number], size: [.35, .85, .15] as [number, number, number] }))), 'flush-door-handles')

  addShinkansenRoof(exterior, spec, type, index, total, { primary, pearl, silver, dark })

  if (cab) {
    const windStart = noseStart + spec.noseLength * (type === 'e7' ? .09 : .13)
    const windEnd = noseStart + spec.noseLength * (type === 'e7' ? .46 : .345)
    patch(exterior, spec, type, windStart - .8, windEnd + .65, type === 'e7' ? .66 : .62, frame, 'swept-cab-windshield-surround')
    patch(exterior, spec, type, windStart, windEnd, type === 'e7' ? .60 : .56, glass, 'curved-dark-cab-windshield')
    const reflection = new THREE.MeshStandardMaterial({ color: '#587c92', metalness: .1, roughness: .2, transparent: true, opacity: .65, side: THREE.DoubleSide })
    patch(exterior, spec, type, windStart + .5, windStart + 1.2, .44, reflection, 'windshield-sky-reflection')
    const lens = new THREE.MeshStandardMaterial({ color: noseDirection === 1 ? '#fff9de' : '#dc3f45', emissive: noseDirection === 1 ? '#fff1c3' : '#eb2933', emissiveIntensity: .95, roughness: .17 })
    if (type === 'e5') {
      const lamps: BoxPart[] = []
      for (const theta of [1.31, 1.44, 1.57, 1.70, 1.83]) {
        const x = windStart - .30, point = shinkansenSurface(spec, type, x, theta).addScaledVector(surfaceNormal(spec, type, x, theta), .10)
        lamps.push({ position: [point.x, point.y, point.z], size: [.9, .3, .65], rotation: new THREE.Euler(0, 0, -.10) })
      }
      boxes(exterior, lens, lamps, noseDirection === 1 ? 'five-cab-crown-headlights' : 'cab-crown-tail-lights')
    } else {
      for (const side of [-1, 1]) {
        const triangle: [number, number][] = type === 'e6' ? [[.31, .58], [.46, .19], [.45, .57]] : [[.46, .53], [.68, .20], [.62, .60]]
        noseTriangle(exterior, spec, type, triangle, side, frame, 'swept-triangular-headlight-pocket')
        const lamps = type === 'e6' ? [[.36, .49], [.405, .40], [.445, .31]] : [[.535, .44], [.60, .34]]
        for (const [t, theta] of lamps) {
          const angle = side === 1 ? theta : Math.PI - theta, x = noseStart + t * spec.noseLength
          const point = shinkansenSurface(spec, type, x, angle).addScaledVector(surfaceNormal(spec, type, x, angle), .15)
          const light = new THREE.Mesh(new THREE.SphereGeometry(type === 'e6' ? .39 : .46, 8, 6), lens)
          light.name = noseDirection === 1 ? 'white-shoulder-headlight' : 'red-shoulder-tail-light'; light.position.copy(point); exterior.add(light)
        }
      }
    }
    // Two fine curved wiper strokes follow the visor rather than floating in
    // front of a flat cab face. They remain visible when inspecting up close.
    for (const side of [-1, 1]) {
      const points = Array.from({ length: 5 }, (_, i) => {
        const x = windEnd - 1.4 - i * (windEnd - windStart) * .032, theta = Math.PI / 2 + side * (.18 + i * .052)
        return shinkansenSurface(spec, type, x, theta).addScaledVector(surfaceNormal(spec, type, x, theta), .135)
      })
      mesh(exterior, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 8, .065, 4, false), dark, 'windscreen-wiper')
    }
  }

  addBogies(car, spec, silver, dark, silver)
  const gangwayHeight = (spec.height + FLOOR) / 2
  for (const end of [-1, 1]) {
    const cabEnd = noseDirection === end, name = end === 1 ? 'front' : 'rear'
    const coupling = new THREE.Object3D(); coupling.name = `coupling-${name}`; coupling.position.set(end * halfLength, 3.45, 0); coupling.userData.cab = cabEnd; car.add(coupling)
    if (!cabEnd) {
      const gangway = new THREE.Object3D(); gangway.name = `gangway-${name}`; gangway.position.set(end * halfLength, gangwayHeight, 0); car.add(gangway)
      boxes(car, dark, [{ position: [end * (halfLength + .08), gangwayHeight, 0], size: [.18, spec.height - FLOOR - .7, spec.width - 1.3] }], `recessed-inter-car-diaphragm-${name}`)
      boxes(car, dark, [{ position: [end * (halfLength - .6), 3.45, 0], size: [1.8, 1.0, 2.0] }], `covered-coupler-mount-${name}`)
    }
  }
  return car
}
