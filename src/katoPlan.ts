import type { LayoutData, PlacedAccessory } from './layout'
import { endpoints, pathsFor, SNAP_ANGLE, SNAP_DISTANCE } from './track'
import type { Endpoint, Track } from './track'

export const KATO_PLAN02_SOURCE = 'https://www.katomodels.com/unitrackplan/plan/plan02-1a.pdf'
export const KATO_PLAN02_ASSEMBLY_NOTE = 'Nominal assembly fit: connector yaw is at most 0.245°, with coincident connector positions. Catalog lengths and radii are retained. Incline support datums and graded curves require physical verification.'

interface Piece {
  kind: string
  bend?: 1 | -1
  endHeight?: number
  /** The right turnout is entered through its straight exit. */
  reversed?: boolean
}

// Follow the main circuit from the left turnout, around the right ground loop,
// up the central incline, across the red bridge, and around the left ground loop.
// Every entry is one physical piece in the official plan's bill of materials.
const MAIN: readonly Piece[] = [
  { kind: 't6l', bend: -1 },
  { kind: 's248' }, { kind: 's248' }, { kind: 's248' }, { kind: 's248' },
  { kind: 't6r', bend: 1, reversed: true }, { kind: 's62-feeder' },
  { kind: 'c315', bend: -1 }, { kind: 'c315', bend: -1 }, { kind: 's248' },
  { kind: 'c315', bend: -1 }, { kind: 'c315', bend: -1 },
  { kind: 's124-rerailer' }, { kind: 's248' }, { kind: 's248' },
  { kind: 'c315', bend: -1 }, { kind: 's248' },
  { kind: 'c315', bend: 1, endHeight: 5 },
  { kind: 'c315', bend: 1, endHeight: 10 },
  { kind: 'v315', bend: 1, endHeight: 25 },
  { kind: 'v315', bend: 1, endHeight: 35 },
  { kind: 'v248', endHeight: 45 },
  { kind: 'v315', bend: 1, endHeight: 55 },
  { kind: 'v315', bend: 1, endHeight: 60 },
  { kind: 'v248', endHeight: 60 }, { kind: 'v124', endHeight: 60 },
  { kind: 'b248-red', endHeight: 60 }, { kind: 'v124', endHeight: 60 },
  { kind: 'v315', bend: 1, endHeight: 60 },
  { kind: 'v315', bend: 1, endHeight: 55 },
  { kind: 'v315', bend: 1, endHeight: 45 },
  { kind: 'v248', endHeight: 35 }, { kind: 'v248', endHeight: 25 },
  { kind: 'v315', bend: 1, endHeight: 10 },
  { kind: 's248', endHeight: 5 }, { kind: 's248', endHeight: 0 },
  { kind: 's124' },
  { kind: 'c315', bend: -1 }, { kind: 'c315', bend: -1 },
  { kind: 'c315', bend: -1 }, { kind: 'c315', bend: -1 },
  { kind: 's248' }, { kind: 'c315', bend: -1 },
  { kind: 's248' }, { kind: 's62' },
]

// The drawing is nominal: an entirely flat, tangent-perfect assembly ends
// 16.9999 mm away from its origin. These explicit small connector yaw values
// jointly close both circuits using the catalog geometry and actual inclined-
// straight projections. The known nominal #6 branch endpoints otherwise leave
// a 1.0332 mm passing-route gap. They do not change a purchased curve's angle
// or radius, and the 0.245° fitting bound remains below SNAP_ANGLE (0.25°).
// Values are degrees, keyed by the ONE-based main piece entered at the joint.
const MAIN_JOIN_YAW: Readonly<Record<number, number>> = {
  2: -.187293354636, 3: -.199491323985, 4: -.209004923615,
  5: -.202721927878, 6: -.204233609558, 7: .157279840417,
  8: .158257963309, 9: .147534756482, 10: .124738628853,
  11: .078909436323, 12: .044849153589, 13: .024886768191,
  14: .020367002725, 15: -.017083230834, 16: -.020708255305,
  17: -.019296105663, 18: .026889556234, 19: .015475057075,
  20: -.028975419952, 21: -.065878546602, 22: -.093448144628,
  23: -.113079745992, 24: -.122300938145, 25: -.136024736431,
  29: .038153539037, 30: .073664926856, 31: .130424044921,
  32: .120644512425, 33: .114617632702, 34: .108139260593,
  35: .093437965208, 36: .087596389257, 37: -.034809861597,
  38: -.050436841628, 39: -.071078213127, 40: -.065466937831,
  41: -.035002533253, 42: .019915587772, 43: .077801667398,
  44: .099748789443, 45: .113002171877,
}
const PASSING_JOIN_YAW = [
  .024733636240, -.149768495703, -.244999999699,
  -.244999999703, -.244999998158, -.142710282645,
] as const

// S, numbered piers, and SPC are actual plan symbols. Their roadbed heights
// below are display assumptions, not independently verified manufacturer
// datums. Catalog support entries retain that distinction for engineering.
const SUPPORTS: readonly { mainPiece: number; kind: string }[] = [
  { mainPiece: 19, kind: 'a-incline-spacer' },
  { mainPiece: 20, kind: 'a-pier-incline-s' },
  { mainPiece: 21, kind: 'a-pier-incline-1' },
  { mainPiece: 22, kind: 'a-pier-incline-2' },
  { mainPiece: 23, kind: 'a-pier-incline-3' },
  { mainPiece: 24, kind: 'a-pier-incline-4' },
  ...[25, 26, 27, 28, 29, 30].map(mainPiece => ({ mainPiece, kind: 'a-pier-incline-5' })),
  { mainPiece: 31, kind: 'a-pier-incline-4' },
  { mainPiece: 32, kind: 'a-pier-incline-3' },
  { mainPiece: 33, kind: 'a-pier-incline-2' },
  { mainPiece: 34, kind: 'a-pier-incline-1' },
  { mainPiece: 35, kind: 'a-pier-incline-s' },
  { mainPiece: 36, kind: 'a-incline-spacer' },
]

function atConnector(piece: Piece, anchor: Endpoint, index: number): Track {
  const height = anchor.position.z ?? 0
  const track: Track = {
    id: `kato-plan02-main-${index + 1}`,
    kind: piece.kind, x: anchor.position.x, y: anchor.position.y,
    angle: anchor.angle, bend: piece.bend ?? 1,
    elevation: height, endElevation: piece.endHeight ?? 0,
  }
  if (piece.reversed) {
    track.angle += Math.PI
    // Align the far end rather than the origin of the physical turnout.
    const port = endpoints(track)[1].position
    track.x += anchor.position.x - port.x
    track.y += anchor.position.y - port.y
  }
  if (piece.kind === 't6l' || piece.kind === 't6r') {
    track.switchNumber = piece.kind === 't6l' ? 1 : 2
    track.switchState = 'straight'
  }
  return track
}

function passingRoute(main: Track[]): Track[] {
  const start = endpoints(main[0])[2]
  const target = endpoints(main[5])[2]
  const descriptions: readonly Piece[] = [
    { kind: 's64' }, { kind: 'c718', bend: 1 },
    { kind: 's248' }, { kind: 's248' },
    { kind: 'c718', bend: 1 }, { kind: 's64' },
  ]
  const flat: Track[] = []
  let anchor = start
  for (const [index, piece] of descriptions.entries()) {
    const yaw = PASSING_JOIN_YAW[index] * Math.PI / 180
    if (Math.abs(yaw) > SNAP_ANGLE) throw new Error('The KATO passing-route fit exceeds the connector angle tolerance.')
    const track = atConnector(piece, { ...anchor, angle: anchor.angle + yaw }, index)
    track.id = `kato-plan02-passing-${index + 1}`
    flat.push(track)
    anchor = endpoints(track)[1]
  }

  const gap = Math.hypot(target.position.x - anchor.position.x, target.position.y - anchor.position.y)
  if (gap > SNAP_DISTANCE) throw new Error('The KATO passing-route fit exceeds the connector tolerance.')
  return flat
}

/** Official M1 + V1 + V2 figure-eight plan, with its passing loop and 18 supports. */
export function makeKatoPlan02(): LayoutData {
  const main: Track[] = []
  let anchor: Endpoint = { position: { x: 0, y: 0, z: 0 }, angle: 0 }
  for (const [index, piece] of MAIN.entries()) {
    const yaw = (MAIN_JOIN_YAW[index + 1] ?? 0) * Math.PI / 180
    if (Math.abs(yaw) > SNAP_ANGLE) throw new Error('The KATO main-route fit exceeds the connector angle tolerance.')
    const track = atConnector(piece, { ...anchor, angle: anchor.angle + yaw }, index)
    main.push(track)
    anchor = endpoints(track)[piece.reversed ? 0 : 1]
  }
  const tracks = [...main, ...passingRoute(main)]
  const accessories: PlacedAccessory[] = SUPPORTS.map(({ mainPiece, kind }, index) => {
    const track = main[mainPiece - 1]
    return {
      id: `kato-plan02-support-${index + 1}`, kind,
      x: track.x, y: track.y, angle: track.angle, elevation: 0,
    }
  })

  // Keep the complete plan centered on the scene's table. Translation changes
  // neither the fit nor the source's relative support/crossing placement.
  const points = tracks.flatMap(track => pathsFor(track).flatMap(path =>
    Array.from({ length: 17 }, (_, index) => path.pointAt(path.length * index / 16))))
  const centerX = (Math.min(...points.map(point => point.x)) + Math.max(...points.map(point => point.x))) / 2
  const centerY = (Math.min(...points.map(point => point.y)) + Math.max(...points.map(point => point.y))) / 2
  for (const placed of [...tracks, ...accessories]) {
    placed.x -= centerX
    placed.y -= centerY
  }
  return {
    version: 2, name: 'KATO M1 + V1 + V2', sourcePlan: 'kato-plan02-1a',
    tracks, accessories, carCount: 3,
  }
}
