import * as THREE from 'three'
import type { TrainSpec, TrainType } from './trains'

export type ShinkansenRoofType = Exclude<TrainType, 'e235'>
export interface ShinkansenRoofMaterials {
  primary: THREE.Material
  pearl: THREE.Material
  silver: THREE.Material
  dark: THREE.Material
}
export interface ShinkansenRoofConfiguration {
  series: ShinkansenRoofType
  /** Roof equipment reference, not a claim that a play car has this service number. */
  prototypeRoofCarNumber: number
  /** Alias retained for compact renderer inspection diagnostics. */
  prototypeCarNumber: number
  prototypeFormation: boolean
  prototypeCarCount: number
  roofRole: 'cab' | 'pantograph' | 'intermediate'
  pantograph: boolean
  pantographDirection: 1 | -1
  antennaStyle: 'swept-blade' | 'low-wedge' | null
}

const PROTOTYPES = {
  // KATO's official formation diagrams: E5 3/7, E6 12/16, E7 3/7.
  // The renderer's leading car is the high-numbered outside cab.
  e5: { first: 10, last: 1, pantographs: [7, 3] },
  e6: { first: 17, last: 11, pantographs: [16, 12] },
  e7: { first: 12, last: 1, pantographs: [7, 3] },
} as const

/** Resample the two authentic roof roles into the requested play formation.
 * Three cars have one representative collector; four or more retain both.
 * At the real formation count every roof reference has its original number.
 */
export function getShinkansenRoofConfiguration(type: ShinkansenRoofType, index: number, total: number): ShinkansenRoofConfiguration {
  const prototype = PROTOTYPES[type]
  const count = Math.max(1, Math.floor(total))
  const lastIndex = count - 1
  const cab = index === 0 || index === lastIndex
  const span = prototype.first - prototype.last
  const pantographIndices = count < 3 ? [] : count === 3 ? [1] : prototype.pantographs.map((number, order) =>
    THREE.MathUtils.clamp(Math.round((prototype.first - number) / span * lastIndex), 1 + order, lastIndex - 2 + order))
  const pantographOrdinal = pantographIndices.indexOf(index)
  const pantograph = !cab && pantographOrdinal >= 0
  const prototypeRoofCarNumber = pantograph ? prototype.pantographs[pantographOrdinal] :
    Math.round(prototype.first - span * index / Math.max(1, lastIndex))
  return {
    series: type,
    prototypeRoofCarNumber,
    prototypeCarNumber: prototypeRoofCarNumber,
    prototypeFormation: count === span + 1,
    prototypeCarCount: span + 1,
    roofRole: cab ? 'cab' : pantograph ? 'pantograph' : 'intermediate',
    pantograph,
    pantographDirection: pantographOrdinal === 1 ? -1 : 1,
    antennaStyle: cab ? type === 'e7' ? 'low-wedge' : 'swept-blade' : null,
  }
}

type BoxPart = { position: [number, number, number]; size: [number, number, number]; rotation?: THREE.Euler }

function boxes(parent: THREE.Object3D, material: THREE.Material, parts: BoxPart[], name: string) {
  if (!parts.length) return
  const object = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, parts.length)
  object.name = name
  const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion()
  parts.forEach((part, index) => {
    quaternion.setFromEuler(part.rotation ?? new THREE.Euler())
    matrix.compose(new THREE.Vector3(...part.position), quaternion, new THREE.Vector3(...part.size))
    object.setMatrixAt(index, matrix)
  })
  object.castShadow = object.receiveShadow = true
  parent.add(object)
  return object
}

function mesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, name: string) {
  const object = new THREE.Mesh(geometry, material)
  object.name = name
  object.castShadow = object.receiveShadow = true
  parent.add(object)
  return object
}

/** The ordinary roof's rounded section, matching the unchanged body loft.
 * Roof fittings stay behind the nose transition, so no nose shape is duplicated.
 */
function roofY(spec: TrainSpec, z: number) {
  const cos = Math.min(1, Math.abs(z) / (spec.width / 2)) ** (1 / .67)
  return (spec.height + 4.8) / 2 + (spec.height - 4.8) / 2 * (Math.sqrt(1 - cos * cos)) ** .67
}

function fittedPanel(spec: TrainSpec, start: number, end: number, halfWidth: number, lift: number) {
  const positions: number[] = [], indices: number[] = []
  for (const x of [start, end]) for (let across = 0; across <= 10; across++) {
    const z = -halfWidth + across * halfWidth / 5
    positions.push(x, roofY(spec, z) + lift, z)
  }
  for (let across = 0; across < 10; across++) {
    const a = across, b = across + 1, c = across + 11, d = across + 12
    indices.push(a, b, c, b, d, c)
  }
  const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)).setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/** Extruded, ramp-ended silhouette: a shield or a small swept radio blade.
 * Unlike a roof capsule this has a flat attachment and an aerodynamic taper.
 */
function profileGeometry(points: [number, number][], width: number) {
  const shape = new THREE.Shape()
  points.forEach(([x, y], index) => index ? shape.lineTo(x, y) : shape.moveTo(x, y))
  shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: true, bevelSize: .045, bevelThickness: .04, bevelSegments: 2, steps: 1, curveSegments: 4 })
  geometry.translate(0, 0, -width / 2)
  return geometry
}

function link(parent: THREE.Object3D, start: THREE.Vector3, end: THREE.Vector3, radius: number, material: THREE.Material, name: string) {
  const direction = end.clone().sub(start)
  const object = mesh(parent, new THREE.CylinderGeometry(radius, radius, direction.length(), 6), material, name)
  object.position.copy(start).add(end).multiplyScalar(.5)
  object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize())
  return object
}

function addServicePanels(parent: THREE.Group, spec: TrainSpec, configuration: ShinkansenRoofConfiguration, materials: ShinkansenRoofMaterials) {
  const half = spec.length / 2
  const start = -half + 4
  const end = half - spec.noseLength - (configuration.roofRole === 'cab' ? 3.8 : 4)
  const seamMaterial = new THREE.LineBasicMaterial({ color: '#5b6871', transparent: true, opacity: .38 })
  const seamPositions: number[] = []
  const addLine = (points: THREE.Vector3[]) => {
    for (let i = 0; i < points.length - 1; i++) seamPositions.push(...points[i].toArray(), ...points[i + 1].toArray())
  }
  // Longitudinal access-panel joins and curved transverse expansion seams.
  for (const z of [-3.2, 3.2]) addLine([new THREE.Vector3(start, roofY(spec, z) + .08, z), new THREE.Vector3(end, roofY(spec, z) + .08, z)])
  const span = end - start, divisions = Math.max(2, Math.floor(span / 29))
  for (let i = 0; i <= divisions; i++) {
    const x = start + span * i / divisions
    addLine(Array.from({ length: 9 }, (_, step) => {
      const z = -spec.width * .32 + spec.width * .08 * step
      return new THREE.Vector3(x, roofY(spec, z) + .075, z)
    }))
  }
  const seams = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(seamPositions, 3)), seamMaterial)
  seams.name = 'roof-service-panel-seams'
  parent.add(seams)

  // Small, flush ventilation fields, rather than invented raised AC pods.
  // JR East describes E6 air conditioning beneath the floor (Tech Review31).
  const ventCenters = configuration.roofRole === 'cab' ? [start + span * .52] : configuration.pantograph ? [half * .58] : [-half * .48, half * .48]
  const slots: BoxPart[] = []
  for (const x of ventCenters) {
    mesh(parent, fittedPanel(spec, x - 4.7, x + 4.7, 2.15, .07), materials.primary, 'flush-roof-ventilation-panel')
    for (let slit = 0; slit < 9; slit++) slots.push({ position: [x - 3.8 + slit * .95, spec.height + .125, 0], size: [.13, .045, 3.5] })
  }
  boxes(parent, materials.dark, slots, 'flush-roof-ventilation-grilles')

  // E6 photographs show a narrow warm-toned longitudinal roof cable/conduit.
  // It is broken around the collector, and never drawn over a cab windshield.
  if (configuration.series === 'e6' && configuration.roofRole !== 'cab') {
    const conduit = new THREE.MeshStandardMaterial({ color: '#af9a69', metalness: .35, roughness: .64 })
    const pieces: BoxPart[] = configuration.pantograph ? [
      { position: [(start - 26) / 2, spec.height + .21, 1.8], size: [-26 - start, .18, .23] },
      { position: [(end + 10) / 2, spec.height + .21, 1.8], size: [end - 10, .18, .23] },
    ] : [{ position: [(start + end) / 2, spec.height + .21, 1.8], size: [span, .18, .23] }]
    boxes(parent, conduit, pieces, 'longitudinal-roof-conduit')
    boxes(parent, materials.silver, Array.from({ length: 6 }, (_, i) => ({ position: [start + span * i / 5, spec.height + .17, 1.8], size: [.36, .22, .6] })), 'roof-conduit-clips')
  }
}

function addCabAntenna(parent: THREE.Group, spec: TrainSpec, configuration: ShinkansenRoofConfiguration, materials: ShinkansenRoofMaterials) {
  const antenna = new THREE.Group()
  antenna.name = 'cab-radio-antenna'
  // Local +x always points toward this cab's nose. The whole rear exterior,
  // including the antenna, is mirrored by the existing model factory.
  antenna.position.set(-spec.length / 2 + (configuration.series === 'e7' ? 10.6 : 12.8), spec.height + .10, 0)
  antenna.userData = { style: configuration.antennaStyle, prototypeRoofCarNumber: configuration.prototypeRoofCarNumber }
  boxes(antenna, materials.silver, [{ position: [0, .14, 0], size: [3.8, .28, 1.45] }], 'cab-antenna-base')
  const radio = new THREE.MeshStandardMaterial({ color: '#e1e4de', metalness: .12, roughness: .56 })
  const profile: [number, number][] = configuration.antennaStyle === 'low-wedge' ?
    [[-1.65, .24], [-.72, 1.85], [.42, 1.75], [1.55, .24]] :
    [[-1.48, .24], [-.98, 1.12], [.25, 1.62], [.77, 1.48], [1.38, .24]]
  mesh(antenna, profileGeometry(profile, configuration.series === 'e7' ? .72 : .66), radio, 'streamlined-radio-blade')
  parent.add(antenna)
}

function addPantograph(parent: THREE.Group, spec: TrainSpec, configuration: ShinkansenRoofConfiguration, materials: ShinkansenRoofMaterials) {
  const assembly = new THREE.Group()
  assembly.name = 'streamlined-pantograph-and-noise-shields'
  assembly.position.set(-8, spec.height + .1, 0)
  assembly.rotation.y = configuration.pantographDirection === -1 ? Math.PI : 0
  assembly.userData = { prototypeRoofCarNumber: configuration.prototypeRoofCarNumber, direction: configuration.pantographDirection }
  const porcelain = new THREE.MeshStandardMaterial({ color: '#e5e5d9', roughness: .48, metalness: .04 })
  const shield = new THREE.MeshStandardMaterial({ color: '#afb7be', metalness: .25, roughness: .53 })
  const collectorRed = new THREE.MeshStandardMaterial({ color: '#b82f3b', metalness: .34, roughness: .46 })

  mesh(assembly, fittedPanel(spec, -15.5, 15.5, 4.8, -spec.height + .11), materials.silver, 'pantograph-well')
  boxes(assembly, materials.dark, [{ position: [0, .23, 0], size: [20, .22, 6.8] }], 'pantograph-recess-and-mounting-bed')
  const shieldHeight = configuration.series === 'e5' ? 4.8 : configuration.series === 'e6' ? 2.65 : 2.85
  const shieldHalfLength = configuration.series === 'e5' ? 15.4 : 13.6
  const silhouette: [number, number][] = [
    [-shieldHalfLength, .06], [-shieldHalfLength + 2.5, .8], [-shieldHalfLength + 5.8, shieldHeight],
    [shieldHalfLength - 5.4, shieldHeight], [shieldHalfLength - 2.4, .9], [shieldHalfLength, .06],
  ]
  const shields = new THREE.Group()
  shields.name = configuration.series === 'e5' ? 'e5-tall-pantograph-noise-shields' : configuration.series === 'e6' ? 'e6-low-pantograph-ramp-fairings' : 'e7-compact-pantograph-fairings'
  for (const side of [-1, 1]) {
    const sideShield = mesh(shields, profileGeometry(silhouette, .48), shield, 'aerodynamic-side-shield')
    sideShield.position.z = side * (configuration.series === 'e6' ? 4.4 : 5.15)
    sideShield.position.y = roofY(spec, sideShield.position.z) - spec.height + .12
  }
  assembly.add(shields)

  // Four porcelain bases with visible annular sheds support the collector.
  const insulators = new THREE.InstancedMesh(new THREE.CylinderGeometry(.60, .70, .9, 8), porcelain, 12)
  insulators.name = 'pantograph-insulators'
  const matrix = new THREE.Matrix4()
  let instance = 0
  for (const x of [-4.8, 4.8]) for (const z of [-2.2, 2.2]) for (let ring = 0; ring < 3; ring++) {
    matrix.makeTranslation(x, .7 + ring * .4, z)
    matrix.scale(new THREE.Vector3(1, .34, 1)); insulators.setMatrixAt(instance++, matrix)
  }
  assembly.add(insulators)
  const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(.34, .38, 1.35, 8), porcelain, 4)
  posts.name = 'pantograph-insulator-stems'
  instance = 0
  for (const x of [-4.8, 4.8]) for (const z of [-2.2, 2.2]) {
    matrix.makeTranslation(x, .925, z); posts.setMatrixAt(instance++, matrix)
  }
  assembly.add(posts)
  boxes(assembly, materials.silver, [{ position: [0, 1.6, 0], size: [11.8, .45, 5.4] }], 'pantograph-metal-base-frame')

  const arm = new THREE.Group()
  arm.name = 'single-arm-pantograph'
  // Explicit shared pivot positions keep the raised single-arm geometry joined.
  const foot = new THREE.Vector3(-4.2, 1.9, 0)
  const elbow = new THREE.Vector3(2.3, 5.2, 0)
  const top = new THREE.Vector3(-2.1, 8.1, 0)
  link(arm, foot, elbow, .21, collectorRed, 'pantograph-lower-arm')
  for (const side of [-1, 1]) link(arm, elbow.clone().add(new THREE.Vector3(0, 0, side * .46)), top.clone().add(new THREE.Vector3(0, 0, side * .46)), .145, collectorRed, 'pantograph-upper-arm')
  for (const point of [foot, elbow, top]) {
    const joint = mesh(arm, new THREE.CylinderGeometry(.34, .34, 1.4, 8), materials.silver, 'pantograph-hinge')
    joint.rotation.x = Math.PI / 2; joint.position.copy(point)
  }
  const contact = new THREE.Group()
  contact.name = 'pantograph-contact-strip'
  contact.position.copy(top)
  boxes(contact, collectorRed, [{ position: [0, .14, 0], size: [1.2, .34, 8.7] }], 'pantograph-collector-head')
  boxes(contact, materials.dark, [{ position: [0, .40, 0], size: [.7, .18, 9.4] }], 'carbon-contact-strip')
  for (const side of [-1, 1]) link(contact, new THREE.Vector3(0, .34, side * 4.5), new THREE.Vector3(0, -.28, side * 5.4), .12, materials.silver, 'collector-end-horn')
  arm.add(contact); assembly.add(arm)

  const voltage = new THREE.Group()
  voltage.name = 'high-voltage-roof-equipment'
  voltage.position.set(-25, .3, 0)
  const rings = new THREE.InstancedMesh(new THREE.CylinderGeometry(.67, .81, .20, 8), porcelain, 10)
  rings.name = 'high-voltage-insulators'
  for (let i = 0; i < 10; i++) { matrix.makeTranslation(i < 5 ? -2.5 : 2.5, .25 + i % 5 * .33, 0); rings.setMatrixAt(i, matrix) }
  voltage.add(rings)
  const voltagePosts = new THREE.InstancedMesh(new THREE.CylinderGeometry(.37, .41, 1.75, 8), porcelain, 2)
  voltagePosts.name = 'high-voltage-insulator-stems'
  for (let i = 0; i < 2; i++) { matrix.makeTranslation(i ? 2.5 : -2.5, .925, 0); voltagePosts.setMatrixAt(i, matrix) }
  voltage.add(voltagePosts)
  boxes(voltage, materials.silver, [{ position: [0, 1.80, 0], size: [6.8, .30, .5] }], 'roof-isolator-link')
  link(voltage, new THREE.Vector3(3.2, 1.8, 0), new THREE.Vector3(17.5, 1.8, 0), .14, materials.dark, 'high-voltage-roof-cable')
  assembly.add(voltage)
  parent.add(assembly)
}

/** Original procedural details drawn from the official KATO formation diagrams,
 * KATO oblique exterior photos and JR East Technical Review31. Fine panel sizes,
 * radio-blade dimensions and electrical fittings are photo-based approximations.
 * The original body loft, wheel/bogie pivots and coupling mounts are untouched.
 */
export function addShinkansenRoof(exterior: THREE.Object3D, spec: TrainSpec, type: ShinkansenRoofType, index: number, total: number, materials: ShinkansenRoofMaterials): THREE.Group {
  const configuration = getShinkansenRoofConfiguration(type, index, total)
  const roof = new THREE.Group()
  roof.name = 'series-specific-roof-equipment'
  roof.userData = { ...configuration }
  addServicePanels(roof, spec, configuration, materials)
  if (configuration.roofRole === 'cab') addCabAntenna(roof, spec, configuration, materials)
  if (configuration.pantograph) addPantograph(roof, spec, configuration, materials)
  exterior.add(roof)
  return roof
}
