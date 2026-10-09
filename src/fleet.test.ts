import { describe, expect, it } from 'vitest'
import { createLayout } from './layout'
import { auditClearances, checkPlacement } from './clearance'
import { auditEngineering } from './engineering'
import { fleetTrainTypes, initialTrainPosition, restoreFleet, snapshotFleetLayout, trainSnapshot } from './fleet'
import type { TrainRuntime } from './fleet'
import { pathsFor } from './track'
import { TRAIN_TYPES, getTrainSpec } from './trains'

describe('independent fleet snapshots', () => {
  it.each(TRAIN_TYPES)('restores legacy %s as the same deterministic paused set', type => {
    const layout = { ...createLayout('compact'), trainType: type, carCount: 7 }
    const first = restoreFleet(layout)
    expect(first).toEqual(restoreFleet(layout))
    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({ id: 'train-1', type, carCount: 7, requestedSpeed: 65, actualSpeed: 0, running: false, status: 'stopped', cabForward: true, legacyStart: true })
    expect(first[0].position).toEqual(initialTrainPosition(layout.tracks, type, 7))
    expect(first[0].name).toContain(getTrainSpec(type).name)
  })

  it('keeps an empty railway unplaced instead of using a nonexistent cursor', () => {
    expect(initialTrainPosition([])).toBeNull()
    expect(restoreFleet(createLayout('empty'))[0]).toMatchObject({ position: null, status: 'unplaced', running: false })
  })

  it('starts on the selected scissors branch using its real route length', () => {
    const track = { id: 'points', kind: 'scissors', x: 0, y: 0, angle: 0, bend: 1 as const, switchState: 'branch' as const }
    expect(initialTrainPosition([track], 'e5', 3)).toMatchObject({ trackId: 'points', route: 2, direction: 1 })
  })

  it('restores duplicate models as independent paused objects with exact cursors and orientation', () => {
    const layout = createLayout('city')
    const base = restoreFleet(layout)[0]
    const second: TrainRuntime = { ...base, id: 'train-2', name: 'Second E235', position: { ...base.position!, distance: 10, laps: 4 }, cabForward: false, actualSpeed: 80, requestedSpeed: 95, running: true, status: 'moving', reverseRequested: true, stopReason: 'Old stop' }
    const saved = snapshotFleetLayout(layout, [base, second], 'train-2')
    const restored = restoreFleet(saved)
    expect(saved.selectedTrainId).toBe('train-2')
    expect(restored.map(train => train.id)).toEqual(['train-1', 'train-2'])
    expect(restored[1]).toMatchObject({ position: second.position, cabForward: false, requestedSpeed: 90, running: false, actualSpeed: 0, lapProgress: 0, status: 'stopped' })
    expect(restored[1]).not.toHaveProperty('reverseRequested')
    expect(restored[1]).not.toHaveProperty('stopReason')
    restored[1].position!.distance = 20
    expect(saved.trains![1].position!.distance).toBe(10)
    expect(second.position!.distance).toBe(10)
    expect(restored[0].position).not.toBe(restored[1].position)
  })

  it('snapshots live placements without persisting running commands or changing another set', () => {
    const layout = createLayout('city')
    const original = restoreFleet(layout)[0]
    const moving = { ...original, running: true, actualSpeed: 35, status: 'accelerating' as const, stopReason: 'stale', reverseRequested: true, lapProgress: 200, noseCoupling: { open: .5, extension: .2, locked: false } }
    const snapshot = trainSnapshot(moving)
    expect(Object.keys(snapshot).sort()).toEqual(['cabForward', 'carCount', 'id', 'name', 'position', 'requestedSpeed', 'type', 'legacyStart'].sort())
    expect(snapshot.position).not.toBe(moving.position)
    const selected = { ...moving, id: 'second', name: 'Komachi', type: 'e6' as const, carCount: 3 }
    const saved = snapshotFleetLayout(layout, [moving, selected], selected.id)
    expect(saved).toMatchObject({ version: 5, trainType: 'e6', carCount: 3, selectedTrainId: 'second', couplings: [] })
    expect(saved.trains![0]).toEqual(snapshot)
    expect(layout).not.toHaveProperty('trains')
  })

  it('chooses an existing selection fallback after removal and supports an empty fleet', () => {
    const layout = createLayout('compact')
    const fleet = restoreFleet(layout)
    expect(snapshotFleetLayout(layout, fleet, 'removed').selectedTrainId).toBe('train-1')
    const empty = snapshotFleetLayout(layout, [], 'removed')
    expect(empty.trains).toEqual([])
    expect(empty.selectedTrainId).toBeUndefined()
    expect(restoreFleet(empty)).toEqual([])
  })

  it('retains a legacy partial start through snapshots and omits its marker after explicit clearing', () => {
    const layout = createLayout('compact')
    const original = restoreFleet(layout)[0]
    expect(restoreFleet(snapshotFleetLayout(layout, [original], original.id))[0].legacyStart).toBe(true)
    expect(trainSnapshot({ ...original, legacyStart: false })).not.toHaveProperty('legacyStart')
    expect(trainSnapshot({ ...original, legacyStart: undefined })).not.toHaveProperty('legacyStart')
  })

  it('preserves and deeply snapshots stable partnerships while omitting transient nose poses', () => {
    const layout = createLayout('coupling-demo')
    const fleet = restoreFleet(layout)
    const group = { id: 'coupled-1', e6Id: fleet[0].id, e5Id: fleet[1].id }
    const coupled = snapshotFleetLayout(layout, fleet, fleet[1].id, [group])
    const savedAgain = snapshotFleetLayout(coupled, fleet, fleet[0].id)
    expect(savedAgain.version).toBe(5)
    expect(savedAgain.couplings).toEqual([group])
    expect(savedAgain.couplings![0]).not.toBe(group)
    expect(savedAgain.couplings![0]).not.toBe(coupled.couplings![0])
    expect(restoreFleet(savedAgain).every(train => !train.running && train.actualSpeed === 0)).toBe(true)
    expect(restoreFleet(savedAgain).map(train => train.id)).toEqual(fleet.map(train => train.id))
    expect(snapshotFleetLayout(coupled, fleet, fleet[0].id, []).couplings).toEqual([])
    expect(snapshotFleetLayout(layout, fleet, fleet[0].id, [{ ...group, phase: 'locking' } as typeof group]).couplings).toEqual([group])
  })

  it('saves either cab end on generic Shinkansen pairs as isolated stable data', () => {
    const layout = createLayout('coupling-demo')
    const fleet = restoreFleet(layout).map(train => ({ ...train, type: 'e7' as const,
      running: true, actualSpeed: 40, noseCoupling: { end: 'front' as const, open: 1, extension: 1, locked: true },
    }))
    const group = { id: 'e7-pair', e6Id: fleet[0].id, e5Id: fleet[1].id, e6End: 'front' as const, e5End: 'rear' as const }
    const snapshot = snapshotFleetLayout(layout, fleet, fleet[1].id, [{ ...group, phase: 'locking' } as typeof group])
    expect(snapshot.version).toBe(5)
    expect(snapshot.couplings).toEqual([group])
    expect(snapshot.couplings![0]).not.toBe(group)
    expect(snapshot.trains!.every(train => !('noseCoupling' in train) && !('running' in train))).toBe(true)
    const another = snapshotFleetLayout(snapshot, fleet, fleet[0].id)
    another.couplings![0].e6End = 'rear'
    expect(snapshot.couplings![0].e6End).toBe('front')
    expect(restoreFleet(snapshot).every(train => !train.running && train.actualSpeed === 0 && !train.noseCoupling)).toBe(true)
  })
})

describe('selection-independent fleet engineering checks', () => {
  it('deduplicates repeated model profiles without losing another model', () => {
    expect(fleetTrainTypes({ trainType: 'e235', trains: [{ type: 'e5' }, { type: 'e5' }, { type: 'e6' }] })).toEqual(['e5', 'e6'])
  })

  it('retains the E5 curve minimum when controlling an E6 and deduplicates repeated E5 sets', () => {
    const layout = createLayout('compact')
    const base = restoreFleet(layout)[0]
    const trains = [
      { ...trainSnapshot(base), type: 'e5' as const },
      { ...trainSnapshot(base), id: 'two', type: 'e6' as const },
      { ...trainSnapshot(base), id: 'three', type: 'e5' as const },
    ]
    const geometry = { tracks: [{ ...layout.tracks[0], kind: 'c282' }], accessories: [], trains }
    const issues = auditEngineering({ ...geometry, trainType: 'e6' })
    expect(issues.filter(issue => issue.code === 'curve-below-minimum')).toHaveLength(1)
    expect(issues.find(issue => issue.code === 'curve-below-minimum')!.message).toContain('E5 R315')
    expect(auditEngineering({ ...geometry, trainType: 'e235' })).toEqual(issues)
    expect(new Set(issues.map(issue => issue.id)).size).toBe(issues.length)
  })

  it('blocks a signal cleared by the selected E235 when another fleet model has longer cab overhang', () => {
    const layout = createLayout('compact')
    const curve = { ...layout.tracks[0], kind: 'c315', x: 0, y: 0 }
    const point = pathsFor(curve)[0].pointAt(100)
    const signal = { id: 'signal', kind: 'a-signal', x: point.x - Math.sin(point.angle) * 19.5, y: point.y + Math.cos(point.angle) * 19.5, elevation: 0, angle: point.angle }
    const base = trainSnapshot(restoreFleet(layout)[0])
    const geometry = { tracks: [curve], accessories: [], trainType: 'e235' as const }
    expect(checkPlacement(geometry, signal).allowed).toBe(true)
    const trains = [base, { ...base, id: 'e5-two', type: 'e5' as const }]
    expect(checkPlacement({ ...geometry, trains }, signal).allowed).toBe(false)
    const full = { ...geometry, accessories: [signal], trains }
    const issues = auditClearances(full)
    expect(issues.some(issue => issue.severity === 'error')).toBe(true)
    expect(auditClearances({ ...full, trainType: 'e5' })).toEqual(issues)
    expect(new Set(issues.map(issue => issue.id)).size).toBe(issues.length)
  })
})
