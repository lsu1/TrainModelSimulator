import { KATO_CATALOG } from './catalog'
import type { LayoutData } from './layout'
import { trackLength } from './track'
import type { Track, TrainPosition } from './track'
import { clampTrainSpeed, getTrainCarSpec, getTrainSpec } from './trains'
import type { TrainType } from './trains'

/** A persisted, stopped placement. Runtime animation state is never saved. */
export interface TrainSnapshot {
  id: string
  name: string
  type: TrainType
  carCount: number
  position: TrainPosition | null
  cabForward: boolean
  requestedSpeed: number
  /** Keeps the original open-end starter's partial visibility across migration. */
  legacyStart?: boolean
}

export type TrainStatus = 'unplaced' | 'stopped' | 'accelerating' | 'moving' | 'braking' | 'blocked'

export interface TrainRuntime extends TrainSnapshot {
  actualSpeed: number
  running: boolean
  status: TrainStatus
  lapProgress: number
  stopReason?: string
  reverseRequested?: boolean
}

/** Bounds imported data and rendering work; independent of model compatibility. */
export const MAX_TRAINSETS = 12
export const DEFAULT_TRAIN_SPEED = 65

/** Preserve the original single-train cab reference on older layouts. */
export function initialTrainPosition(tracks: Track[], type: TrainType = 'e235', carCount = 11): TrainPosition | null {
  const first = tracks[0]
  if (!first) return null
  const shape = KATO_CATALOG.find(item => item.kind === first.kind)?.shape
  const route = first.route ?? (first.switchState === 'branch' ? shape === 'scissors' ? 2 : shape === 'turnout' ? 1 : 0 : 0)
  return {
    trackId: first.id,
    distance: Math.min(getTrainCarSpec(type, 0, carCount).length, trackLength(first, route)),
    direction: 1,
    route,
    laps: 0,
  }
}

/** Clone only the stable data, excluding velocity, blocked reasons and commands. */
export function trainSnapshot(train: TrainSnapshot): TrainSnapshot {
  return {
    id: train.id, name: train.name, type: train.type, carCount: train.carCount,
    position: train.position ? { ...train.position } : null,
    cabForward: train.cabForward, requestedSpeed: clampTrainSpeed(train.type, train.requestedSpeed),
    ...(train.legacyStart === true ? { legacyStart: true } : {}),
  }
}

/** All imported/reopened trains start paused, with their physical orientation intact. */
export function restoreFleet(layout: LayoutData): TrainRuntime[] {
  const snapshots: TrainSnapshot[] = layout.version === 3 && layout.trains
    ? layout.trains
    : [{
      id: 'train-1', name: `${getTrainSpec(layout.trainType).name} 1`, type: layout.trainType ?? 'e235',
      carCount: layout.carCount, position: initialTrainPosition(layout.tracks, layout.trainType, layout.carCount),
      cabForward: true, requestedSpeed: DEFAULT_TRAIN_SPEED, legacyStart: true,
    }]
  return snapshots.map(snapshot => ({
    ...trainSnapshot(snapshot), actualSpeed: 0, running: false,
    status: snapshot.position ? 'stopped' : 'unplaced', lapProgress: 0,
  }))
}

/** A full stable fleet snapshot; legacy summaries describe the selected set. */
export function snapshotFleetLayout(
  layout: LayoutData,
  fleet: readonly TrainSnapshot[],
  selectedTrainId: string | null | undefined,
): LayoutData {
  const trains = fleet.map(trainSnapshot)
  const selected = trains.find(train => train.id === selectedTrainId) ?? trains[0]
  return {
    ...layout, version: 3, trains,
    ...(selected ? { selectedTrainId: selected.id, trainType: selected.type, carCount: selected.carCount } : { selectedTrainId: undefined }),
  }
}

/** Audits depend on the fleet's model profiles, never on the controlled selection. */
export function fleetTrainTypes(layout: { trainType?: TrainType; trains?: readonly Pick<TrainSnapshot, 'type'>[] }): TrainType[] {
  return layout.trains?.length
    ? [...new Set(layout.trains.map(train => train.type))]
    : [layout.trainType ?? 'e235']
}
