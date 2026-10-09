import type { TrainSnapshot } from './fleet'
import type { TrainType } from './trains'

export type CouplingTrainType = Exclude<TrainType, 'e235'>
export type CabEnd = 'front' | 'rear'

/** Field names retain older saves: e6Id is the reference train and e5Id
 * its partner. Either may be any Shinkansen model, in either orientation. */
export interface CouplingGroup {
  id: string
  e6Id: string
  e5Id: string
  e6End?: CabEnd
  e5End?: CabEnd
}

export type CouplingPhase = 'opening' | 'approaching' | 'locking' | 'unlocking' | 'separating' | 'closing'
export interface CouplingOperation {
  id: string
  e6Id: string
  e5Id: string
  e6End?: CabEnd
  e5End?: CabEnd
  phase: CouplingPhase
  elapsed: number
  paused: boolean
  /** Stable configuration to recover if interrupted or the browser closes. */
  beforeTrains: TrainSnapshot[]
  beforeGroups: CouplingGroup[]
  separationTravel: number
}

export interface NoseCouplingState {
  open: number
  extension: number
  locked: boolean
  /** Only this physical cab opens; the opposite nose stays closed. */
  end?: CabEnd
  /** Unit coupling axis in the nose exterior's coordinates (+X outward). */
  axis?: { x: number; y: number; z: number }
}

export interface NoseCouplerProfile {
  type: CouplingTrainType
  /** Length of the removable cap, from the original streamlined tip. */
  cutBack: number
  /** Body-mounted pivot inset from the original tip. */
  mountInset: number
  /** Fixed pivot-to-mating-face distance while extended. */
  extensionLength: number
  height: number
}

/** Procedural visual dimensions, not measurements of a KATO mechanism. */
export const NOSE_COUPLER_PROFILES: Readonly<Record<CouplingTrainType, NoseCouplerProfile>> = {
  e5: { type: 'e5', cutBack: 15, mountInset: 18, extensionLength: 3.5, height: 9.5 },
  e6: { type: 'e6', cutBack: 14, mountInset: 17, extensionLength: 3.5, height: 9.5 },
  e7: { type: 'e7', cutBack: 12, mountInset: 15, extensionLength: 3.5, height: 9.5 },
}

export function noseCouplerProfile(type: TrainType): NoseCouplerProfile | null {
  return type === 'e235' ? null : NOSE_COUPLER_PROFILES[type]
}

export const NOSE_JOINT_LENGTH = NOSE_COUPLER_PROFILES.e5.extensionLength + NOSE_COUPLER_PROFILES.e6.extensionLength
export const COUPLING_APPROACH_SPEED = 3
export const COUPLING_SEPARATION_DISTANCE = 55
export const COUPLING_MAX_APPROACH_DISTANCE = 200
