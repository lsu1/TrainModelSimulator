import type { TrainSnapshot } from './fleet'
import type { TrainType } from './trains'

/** Fixed physical order: E6 car 17 ... 11, then E5 car 10 ... 1. */
export interface CouplingGroup {
  id: string
  e6Id: string
  e5Id: string
}

export type CouplingPhase = 'opening' | 'approaching' | 'locking' | 'unlocking' | 'separating' | 'closing'
export interface CouplingOperation {
  id: string
  e6Id: string
  e5Id: string
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
  /** Unit coupling axis in the nose exterior's coordinates (+X outward). */
  axis?: { x: number; y: number; z: number }
}

export interface NoseCouplerProfile {
  type: 'e5' | 'e6'
  /** Length of the removable cap, from the original streamlined tip. */
  cutBack: number
  /** Body-mounted pivot inset from the original tip. */
  mountInset: number
  /** Fixed pivot-to-mating-face distance while extended. */
  extensionLength: number
  height: number
}

/** Procedural visual dimensions, not measurements of a KATO mechanism. */
export const NOSE_COUPLER_PROFILES: Readonly<Record<'e5' | 'e6', NoseCouplerProfile>> = {
  e5: { type: 'e5', cutBack: 15, mountInset: 20, extensionLength: 11, height: 9.5 },
  e6: { type: 'e6', cutBack: 14, mountInset: 18, extensionLength: 10, height: 9.5 },
}

export function noseCouplerProfile(type: TrainType): NoseCouplerProfile | null {
  return type === 'e5' || type === 'e6' ? NOSE_COUPLER_PROFILES[type] : null
}

export const NOSE_JOINT_LENGTH = NOSE_COUPLER_PROFILES.e5.extensionLength + NOSE_COUPLER_PROFILES.e6.extensionLength
export const COUPLING_APPROACH_SPEED = 3
export const COUPLING_SEPARATION_DISTANCE = 55
export const COUPLING_MAX_APPROACH_DISTANCE = 200
