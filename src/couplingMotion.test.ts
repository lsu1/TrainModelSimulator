import { describe, expect, it } from 'vitest'
import { makeCouplingDemo } from './couplingDemo'
import { restoreFleet } from './fleet'
import type { TrainRuntime } from './fleet'
import type { CouplingGroup, CouplingOperation } from './couplingTypes'
import { beginCoupling, beginDecoupling, couplingEligibility, decouplingEligibility, stepCouplingSystem, validateCoupledFleet } from './couplingMotion'
import { solveCoupledFormation } from './formationPose'
import { trainFootprint, trainFootprintsConflict } from './trainSafety'
import { makeKatoPlan02 } from './katoPlan'
import { advanceTrain, sampleBehind } from './track'
import { synchronizeCoupledFleet } from './couplingMotion'
import { occupiedFleetTrackIds } from './fleetMotion'

function fixture() {
  const layout = makeCouplingDemo(), fleet = restoreFleet(layout)
  const e5 = fleet.find(train => train.type === 'e5')!, e6 = fleet.find(train => train.type === 'e6')!
  return { layout, fleet, e5, e6 }
}
function finish(tracks: ReturnType<typeof makeCouplingDemo>['tracks'], fleet: TrainRuntime[], groups: CouplingGroup[], operation: CouplingOperation) {
  let current = { fleet, groups, operation: operation as CouplingOperation | null }, lastMessage = ''
  for (let tick = 0; tick < 400 && current.operation; tick++) {
    const next = stepCouplingSystem(tracks, current.fleet, current.groups, current.operation, .1)
    if (next.message) lastMessage = next.message
    if (next.operation?.paused) throw new Error(`${next.operation.phase}: ${next.message}`)
    current = next
  }
  expect(current.operation, lastMessage).toBeNull()
  return current
}

describe('Shinkansen docking and mixed formation operation', () => {
  it('opens, rail-approaches and locks without moving E6 or changing trainset identities', () => {
    const { layout, fleet, e5, e6 } = fixture()
    expect(couplingEligibility(layout.tracks, fleet, e5.id, e6.id)).toMatchObject({ allowed: true })
    const operation = beginCoupling(layout.tracks, fleet, [], e5.id, e6.id)!
    expect(operation).toBeTruthy()
    const joined = finish(layout.tracks, fleet, [], operation)
    expect(joined.groups).toHaveLength(1)
    expect(joined.fleet.map(train => [train.id, train.type, train.carCount])).toEqual(fleet.map(train => [train.id, train.type, train.carCount]))
    expect(joined.fleet.find(train => train.id === e6.id)!.position).toEqual(e6.position)
    expect(joined.fleet.every(train => !train.running && train.noseCoupling?.locked)).toBe(true)
    const solved = solveCoupledFormation(layout.tracks, joined.fleet.find(train => train.id === e6.id)!, joined.fleet.find(train => train.id === e5.id)!)
    expect(solved.complete).toBe(true)
    expect(joined.fleet.find(train => train.id === e5.id)!.position).toEqual(solved.e5Position)
  }, 15000)

  it('pauses the transaction clock and nose movement and resumes explicitly', () => {
    const { layout, fleet, e5, e6 } = fixture(), operation = beginCoupling(layout.tracks, fleet, [], e5.id, e6.id)!
    const first = stepCouplingSystem(layout.tracks, fleet, [], operation, .1)
    const paused = stepCouplingSystem(layout.tracks, first.fleet, [], { ...first.operation!, paused: true }, 10)
    expect(paused.fleet).toEqual(first.fleet)
    expect(paused.operation!.elapsed).toBe(first.operation!.elapsed)
    const resumed = finish(layout.tracks, paused.fleet, [], { ...paused.operation!, paused: false })
    expect(resumed.groups).toHaveLength(1)
  })

  it('operates both sets together and separates them gradually with closed covers', () => {
    const { layout, fleet, e5, e6 } = fixture(), joined = finish(layout.tracks, fleet, [], beginCoupling(layout.tracks, fleet, [], e5.id, e6.id)!)
    let moving = joined.fleet.map(train => ({ ...train, running: true, requestedSpeed: 100 }))
    for (let tick = 0; tick < 5; tick++) moving = stepCouplingSystem(layout.tracks, moving, joined.groups, null, .1).fleet
    expect(moving.every(train => train.actualSpeed === moving[0].actualSpeed && train.running)).toBe(true)
    const stopped = moving.map(train => ({ ...train, running: false, actualSpeed: 0, status: 'stopped' as const }))
    expect(decouplingEligibility(layout.tracks, stopped, joined.groups[0])).toMatchObject({ allowed: true })
    const split = finish(layout.tracks, stopped, joined.groups, beginDecoupling(layout.tracks, stopped, joined.groups, joined.groups[0])!)
    expect(split.groups).toHaveLength(0)
    expect(split.fleet.every(train => !train.running && train.noseCoupling?.open === 0 && train.noseCoupling.extension === 0)).toBe(true)
    expect(split.fleet.find(train => train.id === e6.id)!.position).toEqual(stopped.find(train => train.id === e6.id)!.position)
    expect(trainFootprintsConflict(trainFootprint(layout.tracks, split.fleet[0]), trainFootprint(layout.tracks, split.fleet[1]))).toBe(false)
  })

  it('rejects moving, incompatible, wrong-facing, parallel-lane and occupied docking candidates', () => {
    const { layout, fleet, e5, e6 } = fixture()
    expect(couplingEligibility(layout.tracks, [{ ...e5, running: true }, e6], e5.id, e6.id).allowed).toBe(false)
    expect(couplingEligibility(layout.tracks, [{ ...e5, type: 'e7' }, e6], e5.id, e6.id).allowed).toBe(false)
    expect(couplingEligibility(layout.tracks, [{ ...e5, cabForward: false }, e6], e5.id, e6.id).allowed).toBe(false)
    const parallel = layout.tracks.map(track => ({ ...track, id: `parallel-${track.id}`, y: track.y + 33 }))
    const otherLane = { ...e5, position: { ...e5.position!, trackId: `parallel-${e5.position!.trackId}` } }
    expect(couplingEligibility([...layout.tracks, ...parallel], [otherLane, e6], e5.id, e6.id).allowed).toBe(false)
    const third = { ...e5, id: 'third', name: 'Third train', type: 'e235' as const }
    expect(couplingEligibility(layout.tracks, [...fleet, third], e5.id, e6.id).allowed).toBe(false)
  })

  it('keeps a joined group on the exact rail graph through curved motion and reversal', () => {
    const { layout, fleet, e5, e6 } = fixture(), joined = finish(layout.tracks, fleet, [], beginCoupling(layout.tracks, fleet, [], e5.id, e6.id)!)
    let current = joined.fleet.map(train => ({ ...train, running: true, requestedSpeed: 320, actualSpeed: 320 }))
    for (let tick = 0; tick < 400; tick++) {
      current = stepCouplingSystem(layout.tracks, current, joined.groups, null, .1).fleet
      expect(current.every(train => train.running), current[0].stopReason).toBe(true)
      const a = current.find(train => train.id === e6.id)!, b = current.find(train => train.id === e5.id)!, solved = solveCoupledFormation(layout.tracks, a, b)
      expect(solved.complete).toBe(true)
      expect(b.position).toEqual(solved.e5Position)
    }
    const before = current.map(train => train.position), stopped = current.map(train => ({ ...train, running: false, actualSpeed: 0, reverseRequested: true }))
    const reversed = stepCouplingSystem(layout.tracks, stopped, joined.groups, null, .1).fleet
    expect(reversed.map(train => train.position!.distance)).toEqual(before.map(position => position!.distance))
    expect(reversed.every(train => !train.cabForward)).toBe(true)
    expect(validateCoupledFleet(layout.tracks, reversed, joined.groups).allowed).toBe(true)
  }, 30000)
  it.each([['straight', true], ['straight', false], ['branch', true], ['branch', false]] as const)('moves an authentic 17-car formation around KATO route %s with forward=%s', (switchState, cabForward) => {
    const { tracks } = makeKatoPlan02()
    tracks.forEach(track => { if (track.switchState) track.switchState = switchState })
    const { e5, e6 } = fixture(), groups = [{ id: 'authentic-group', e5Id: e5.id, e6Id: e6.id }]
    const leader = { ...e6, carCount: 7, position: { trackId: 'kato-plan02-main-7', route: 0, distance: 30, direction: (cabForward ? 1 : -1) as 1 | -1, laps: 0 }, cabForward, requestedSpeed: 320, actualSpeed: 320, running: true }
    let fleet = synchronizeCoupledFleet(tracks, [leader, { ...e5, carCount: 10 }], groups)
    expect(validateCoupledFleet(tracks, fleet, groups).allowed).toBe(true)
    for (let tick = 0; tick < 300; tick++) {
      fleet = stepCouplingSystem(tracks, fleet, groups, null, .1).fleet
      expect(fleet.every(train => train.running), fleet[0].stopReason).toBe(true)
      const a = fleet.find(train => train.id === e6.id)!, b = fleet.find(train => train.id === e5.id)!, solved = solveCoupledFormation(tracks, a, b)
      expect(solved.complete).toBe(true)
      expect(b.position).toEqual(solved.e5Position)
    }
    expect(fleet.find(train => train.id === e6.id)!.position!.laps).toBeGreaterThanOrEqual(1)
    expect(occupiedFleetTrackIds(tracks, fleet, groups).size).toBeGreaterThan(5)
  }, 30000)

  it('stops the whole formation at an open rear end without hiding the E5 tail', () => {
    const { layout, e5, e6 } = fixture(), tracks = layout.tracks.slice(0, 12)
    const groups = [{ id: 'open-group', e5Id: e5.id, e6Id: e6.id }]
    const leader = { ...e6, position: { ...e6.position!, direction: -1 as const }, cabForward: false, running: true, actualSpeed: 320, requestedSpeed: 320 }
    let fleet = synchronizeCoupledFleet(tracks, [leader, e5], groups)
    expect(fleet.every(train => train.position)).toBe(true)
    for (let tick = 0; tick < 100 && fleet.some(train => train.running); tick++) fleet = stepCouplingSystem(tracks, fleet, groups, null, .1).fleet
    expect(fleet.every(train => !train.running && train.status === 'blocked')).toBe(true)
    const a = fleet.find(train => train.id === e6.id)!, b = fleet.find(train => train.id === e5.id)!, solved = solveCoupledFormation(tracks, a, b)
    expect(solved.complete).toBe(true)
    expect(solved.e5.cars.every(Boolean)).toBe(true)
    expect(sampleBehind(tracks, { ...a.position!, direction: 1 }, solved.rearOffset)).toBeTruthy()
  })

  it('pauses safely before a new third train contact and rolls back the failed nose animation step', () => {
    const { layout, fleet, e5, e6 } = fixture(), operation = beginCoupling(layout.tracks, fleet, [], e5.id, e6.id)!
    const first = stepCouplingSystem(layout.tracks, fleet, [], operation, .1)
    const third = { ...e5, id: 'third', name: 'Third train', type: 'e235' as const }
    const blocked = stepCouplingSystem(layout.tracks, [...first.fleet, third], [], first.operation!, .1)
    expect(blocked.operation!.paused).toBe(true)
    expect(blocked.operation!.elapsed).toBe(first.operation!.elapsed)
    expect(blocked.fleet.filter(train => train.id !== 'third')).toEqual(first.fleet)
    expect(blocked.groups).toHaveLength(0)
  })

  it('blocks coupling above and below nearby parallel rails and rejects an out-of-range approach', () => {
    const { layout, fleet, e5, e6 } = fixture()
    const far = { ...e5, position: advanceTrain(layout.tracks, { ...e5.position!, direction: -1 }, 250).position }
    far.position.direction = 1
    expect(couplingEligibility(layout.tracks, [e6, far], e5.id, e6.id).allowed).toBe(false)
    const raised = layout.tracks.map(track => ({ ...track, id: `raised-${track.id}`, elevation: 60, endElevation: 60 }))
    const over = { ...e5, position: { ...e5.position!, trackId: `raised-${e5.position!.trackId}` } }
    expect(couplingEligibility([...layout.tracks, ...raised], [e6, over], e5.id, e6.id).allowed).toBe(false)
    expect(couplingEligibility(layout.tracks, fleet, e5.id, e6.id).allowed).toBe(true)
  })

  it('brakes both linked sets safely for a parked third train at 320 km/h', () => {
    const { layout, e5, e6 } = fixture(), groups = [{ id: 'third-protection', e5Id: e5.id, e6Id: e6.id }]
    const leader = { ...e6, requestedSpeed: 320, actualSpeed: 320, running: true }
    let fleet = synchronizeCoupledFleet(layout.tracks, [leader, e5], groups)
    const third: TrainRuntime = { ...e6, id: 'third', name: 'Parked train', type: 'e235', position: advanceTrain(layout.tracks, e6.position!, 600).position, actualSpeed: 0, running: false }
    fleet.push(third)
    for (let tick = 0; tick < 100 && fleet.some(train => train.id !== 'third' && train.running); tick++) {
      fleet = stepCouplingSystem(layout.tracks, fleet, groups, null, .1).fleet
      const parked = trainFootprint(layout.tracks, fleet.find(train => train.id === 'third')!)
      for (const member of fleet.filter(train => train.id !== 'third')) expect(trainFootprintsConflict(trainFootprint(layout.tracks, member), parked)).toBe(false)
    }
    expect(fleet.filter(train => train.id !== 'third').every(train => !train.running && train.status === 'blocked')).toBe(true)
    expect(fleet.find(train => train.id === 'third')!.position).toEqual(third.position)
  }, 15000)

  it('requires the full two-millimetre closed-nose gap and checks early cover-clearing motion', () => {
    const { layout, e5, e6 } = fixture()
    const originalGap = couplingEligibility(layout.tracks, [e5, e6], e5.id, e6.id).gap!
    const close = (gap: number) => ({ ...e5, position: advanceTrain(layout.tracks, e5.position!, originalGap - gap).position })
    for (const gap of [18.5, 18.6, 18.75, 18.9]) expect(couplingEligibility(layout.tracks, [e6, close(gap)], e5.id, e6.id).allowed).toBe(false)
    const initial = [e6, close(19)]
    expect(couplingEligibility(layout.tracks, initial, e5.id, e6.id).allowed).toBe(true)
    let result = { fleet: initial, groups: [] as CouplingGroup[], operation: beginCoupling(layout.tracks, initial, [], e5.id, e6.id) as CouplingOperation | null }
    for (let tick = 0; tick < 50; tick++) {
      result = stepCouplingSystem(layout.tracks, result.fleet, result.groups, result.operation, .032)
      expect(result.operation?.paused).not.toBe(true)
    }
    expect(result.operation?.phase).toBe('approaching')
  })

})
