/** Procedural rolling-stock profiles, in physical N-scale millimetres.
 * Dimensions describe our meshes, not measured KATO coupling mechanisms.
 * See docs/shinkansen-trains.md for reference photos and verification limits.
 */
export type TrainType = 'e235' | 'e5' | 'e6' | 'e7'
export const TRAIN_TYPES: readonly TrainType[] = ['e235', 'e5', 'e6', 'e7']

export interface TrainSpec {
  type: TrainType
  name: string
  line: string
  model: string
  scale: number
  /** Fastest passenger service for this model/line, in real-world km/h. */
  maxServiceSpeed: number
  speedNote: string
  speedReferenceUrl: string
  /** Intermediate car length; the two end cars use cabLength. */
  length: number
  cabLength: number
  width: number
  /** Roof height above wheel contact, excluding rooftop equipment. */
  height: number
  bogieOffset: number
  /** Coupling pin position from the body centre, mounted on its bogie. */
  couplerOffset: number
  couplingLinkLength: number
  noseLength: number
  carGap: number
  fullFormation: number
  minimumRadius?: number
  referenceUrl: string
  colors: { primary: string; secondary: string; stripe: string }
}

const SHINKANSEN_SCALE = 160
const GAP = 4.2
// Procedural spacing: the additional 0.6 mm prevents rounded Shinkansen
// shells and end fittings touching at combined curve/grade transitions.
// These gaps describe our fixed-link model, not measured KATO couplers.
const SHINKANSEN_GAP = 4.8
export const TRAIN_SPECS: Readonly<Record<TrainType, TrainSpec>> = {
  e235: {
    type: 'e235', name: 'E235 Yamanote Line', line: 'Tokyo · Yamanote', model: 'E235-0', scale: 150,
    maxServiceSpeed: 90,
    speedNote: 'Yamanote service · vehicle specification: 120 km/h',
    speedReferenceUrl: 'https://www.nippon.com/en/japan-topics/b11302/',
    length: 133.3, cabLength: 133.3, width: 20.3, height: 25.05,
    bogieOffset: 43.7, couplerOffset: 43.7, couplingLinkLength: 50.1,
    noseLength: 0, carGap: GAP, fullFormation: 11,
    referenceUrl: 'https://www.katomodels.com/product/n/e235_yamanote_slm',
    colors: { primary: '#91c434', secondary: '#bfc7ca', stripe: '#91c434' },
  },
  e5: {
    type: 'e5', name: 'E5 Shinkansen', line: 'Tohoku / Hokkaido', model: 'E5', scale: SHINKANSEN_SCALE,
    maxServiceSpeed: 320,
    speedNote: 'Fastest Tohoku service · other sections have lower limits',
    speedReferenceUrl: 'https://www.jreast.co.jp/train/shinkan/e5.html',
    length: 156.25, cabLength: 165.625, width: 20.9375, height: 22.8125,
    bogieOffset: 54.6875, couplerOffset: 54.6875, couplingLinkLength: 51.675,
    noseLength: 93.75, carGap: SHINKANSEN_GAP, fullFormation: 10, minimumRadius: 315,
    referenceUrl: 'https://www.katomodels.com/product/n/e5kei_hayabusa_slm',
    colors: { primary: '#008e7d', secondary: '#edf0ed', stripe: '#d55289' },
  },
  e6: {
    type: 'e6', name: 'E6 Shinkansen', line: 'Tohoku / Akita', model: 'E6', scale: SHINKANSEN_SCALE,
    maxServiceSpeed: 320,
    speedNote: 'Tohoku: 320 km/h · conventional Akita section: 130 km/h',
    speedReferenceUrl: 'https://www.jreast.co.jp/train/shinkan/e6.html',
    length: 128.125, cabLength: 142.65625, width: 18.40625, height: 22.0,
    bogieOffset: 46.875, couplerOffset: 46.875, couplingLinkLength: 39.175,
    noseLength: 81.25, carGap: SHINKANSEN_GAP, fullFormation: 7, minimumRadius: 282,
    referenceUrl: 'https://www.katomodels.com/product/n/e6kei_komachi',
    colors: { primary: '#c72f45', secondary: '#e7e8e6', stripe: '#a7acb0' },
  },
  e7: {
    type: 'e7', name: 'E7 Shinkansen', line: 'Hokuriku / Joetsu', model: 'E7', scale: SHINKANSEN_SCALE,
    maxServiceSpeed: 275,
    speedNote: 'Joetsu: 275 km/h · Hokuriku: 260 km/h',
    speedReferenceUrl: 'https://www.jreast.co.jp/train/shinkan/e7.html',
    length: 156.25, cabLength: 162.5, width: 20.9375, height: 22.8125,
    bogieOffset: 54.6875, couplerOffset: 54.6875, couplingLinkLength: 51.675,
    noseLength: 56.25, carGap: SHINKANSEN_GAP, fullFormation: 12, minimumRadius: 315,
    referenceUrl: 'https://www.katomodels.com/product/n/e7kei',
    // Official names: sky blue, ivory white and copper. These display colors
    // are photographic approximations, not published JR paint specifications.
    colors: { primary: '#2862d1', secondary: '#f0eee6', stripe: '#c89b69' },
  },
}

export function isTrainType(value: unknown): value is TrainType {
  return typeof value === 'string' && TRAIN_TYPES.includes(value as TrainType)
}

export function getTrainSpec(type: TrainType = 'e235'): TrainSpec {
  return TRAIN_SPECS[type]
}

/** Shared guard for controls, imported saves and the animation engine. */
export function clampTrainSpeed(type: TrainType, value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(getTrainSpec(type).maxServiceSpeed, value)) : 0
}

/** A fixed cab at each outside end, including shortened play formations. */
export function getTrainCarSpec(type: TrainType = 'e235', index = 0, total = 11): TrainSpec {
  const spec = getTrainSpec(type)
  const count = Number.isFinite(total) ? Math.max(1, Math.floor(total)) : 1
  const cab = index === 0 || index === count - 1
  return { ...spec, length: cab ? spec.cabLength : spec.length, noseLength: cab ? spec.noseLength : 0 }
}

/** Adjacent bogie-mounted pins; the two longer cab shells keep their gap. */
export function getCouplingLinkLength(type: TrainType = 'e235', index = 0, total = 11): number {
  const first = getTrainCarSpec(type, index, total)
  const second = getTrainCarSpec(type, index + 1, total)
  return first.length / 2 - first.bogieOffset + second.length / 2 - second.bogieOffset + first.carGap
}
