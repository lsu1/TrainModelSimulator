import { describe, expect, it } from 'vitest'
import { occupiedFleetTrackIds, stepFleet } from './fleetMotion'
import type { TrainRuntime } from './fleet'
import { advanceTrain, attachTrack, endpoints, makeCityLayout, pathsFor, pointAt } from './track'
import type { Track } from './track'
import { getTrainSpec, TRAIN_TYPES } from './trains'
import type { TrainType } from './trains'
import { trainFootprint, trainFootprintsConflict, trainFootprintOverlapsItself } from './trainSafety'

function line(count = 14, prefix = 'line', y = 0, elevation = 0): Track[] {
  const result: Track[] = []
  let anchor = { position: { x: -1240, y, z: elevation }, angle: 0 }
  for (let index = 0; index < count; index++) {
    const track = attachTrack('s248', 1, anchor, `${prefix}-${index}`)
    result.push(track); const end = endpoints(track)[1]
    anchor = { ...end, position: { ...end.position, z: end.position.z ?? 0 } }
  }
  return result
}
function train(track: Track, distance = 100, id = 'one', direction: 1 | -1 = 1, type: TrainType = 'e235'): TrainRuntime {
  const speed = getTrainSpec(type).maxServiceSpeed
  return { id, name: id, type, carCount: 3, cabForward: true, requestedSpeed: speed, actualSpeed: speed, running: true, status: 'moving', lapProgress: 0,
    position: { trackId: track.id, route: 0, distance, direction, laps: 0 } }
}
function referenceX(tracks: Track[], value: TrainRuntime): number {
  const track = tracks.find(piece => piece.id === value.position?.trackId)!
  return pointAt(track, value.position!.distance, value.position!.route ?? 0).x
}

describe('independent shared-clock train movement', () => {
  it.each(TRAIN_TYPES)('ramps %s to its own service maximum and clamps injected speeds', type => {
    const tracks = line(30)
    const limit = getTrainSpec(type).maxServiceSpeed
    const initial = { ...train(tracks[10], 100, 'one', 1, type), requestedSpeed: limit + 500, actualSpeed: 0 }
    let fleet = [initial]
    for (let tick = 0; tick < 25; tick++) fleet = stepFleet(tracks, fleet, .1)
    expect(fleet[0].requestedSpeed).toBe(limit)
    expect(fleet[0].actualSpeed).toBe(limit)
    expect(fleet[0].status).toBe('moving')
    const injected = { ...initial, actualSpeed: limit + 500 }
    const stoppedFrame = stepFleet(tracks, [injected], 0)[0]
    expect(stoppedFrame.actualSpeed).toBe(limit)
    expect(stoppedFrame.requestedSpeed).toBe(limit)
    expect(stoppedFrame.position).toEqual(injected.position)
    expect(initial.requestedSpeed).toBe(limit + 500)
  })

  it.each([NaN, Infinity, -Infinity, -10])('rejects invalid speed %s before safety substep sizing', invalid => {
    const tracks = line(30)
    const first = { ...train(tracks[10], 100, 'one', 1, 'e5'), requestedSpeed: invalid, actualSpeed: invalid }
    const second = { ...train(tracks[13], 100, 'two', 1, 'e6'), requestedSpeed: invalid, actualSpeed: invalid }
    const result = stepFleet(tracks, [first, second], .1)
    expect(result.every(value => value.requestedSpeed === 0 && value.actualSpeed === 0 && !value.running)).toBe(true)
    expect(result.map(value => value.position)).toEqual([first.position, second.position])
  })

  it('preserves fleet identity, each model scale and immutability with mixed stock', () => {
    const low = line(14, 'low'), high = line(14, 'high', 80)
    const before = [train(low[5]), train(high[5], 100, 'two', 1, 'e5')]
    const original = JSON.stringify(before), after = stepFleet([...low, ...high], before, .05)
    for (let index = 0; index < 2; index++) {
      expect(after[index].id).toBe(before[index].id)
      expect(referenceX([...low, ...high], after[index]) - referenceX([...low, ...high], before[index])).toBeCloseTo(getTrainSpec(before[index].type).maxServiceSpeed / 3.6 * 1000 / getTrainSpec(before[index].type).scale * .05, 6)
      expect(after[index].actualSpeed).toBe(getTrainSpec(before[index].type).maxServiceSpeed)
    }
    expect(JSON.stringify(before)).toBe(original)
  })

  it('ramps one train, immediately pauses another, and keeps unplaced sets still', () => {
    const tracks = line(), first = { ...train(tracks[5]), actualSpeed: 0, requestedSpeed: 65 }
    const second = { ...train(tracks[8], 100, 'two'), running: false }
    const third = { ...train(tracks[5], 100, 'three'), position: null }
    const result = stepFleet(tracks, [first, second, third], .1)
    expect(result[0].actualSpeed).toBeGreaterThan(0)
    expect(result[0].actualSpeed).toBeLessThan(65)
    expect(result[0].status).toBe('accelerating')
    expect(result[1].position).toEqual(second.position)
    expect(result[1].actualSpeed).toBe(0)
    expect(result[2].position).toBeNull()
    expect(result[2].status).toBe('unplaced')
  })

  it('brakes before reversing and changes orientation without relocating parked cars', () => {
    const tracks = line(), original = train(tracks[5]), reverse = { ...original, reverseRequested: true }
    let result: TrainRuntime[] = [reverse]
    for (let tick = 0; tick < 7; tick++) result = stepFleet(tracks, result, .1)
    expect(result[0].running).toBe(false)
    expect(result[0].actualSpeed).toBe(0)
    expect(result[0].cabForward).toBe(false)
    expect(result[0].position!.direction).toBe(-1)
    const parked = { ...original, actualSpeed: 0, running: false }
    const before = trainFootprint(tracks, parked)
    const after = stepFleet(tracks, [{ ...parked, reverseRequested: true }], 0)[0]
    expect(trainFootprint(tracks, after)).toEqual(before)
    expect(occupiedFleetTrackIds(tracks, [after])).toEqual(occupiedFleetTrackIds(tracks, [parked]))
  })

  it('stops head-on trains on the same piece before body contact, without teleportation', () => {
    const tracks = line(), a = train(tracks[5], 10), b = train(tracks[5], 130, 'two', -1)
    let fleet = [a, b], last = fleet.map(value => referenceX(tracks, value))
    for (let tick = 0; tick < 25; tick++) {
      fleet = stepFleet(tracks, fleet, .05)
      expect(trainFootprintsConflict(trainFootprint(tracks, fleet[0]), trainFootprint(tracks, fleet[1]), 0)).toBe(false)
      const positions = fleet.map(value => referenceX(tracks, value))
      expect(positions[0]).toBeGreaterThanOrEqual(last[0] - 1e-6)
      expect(positions[1]).toBeLessThanOrEqual(last[1] + 1e-6)
      expect(positions[0] - last[0]).toBeLessThanOrEqual(12)
      expect(last[1] - positions[1]).toBeLessThanOrEqual(12)
      last = positions
    }
    expect(fleet.every(value => value.status === 'blocked')).toBe(true)
    expect(last[1] - last[0]).toBeGreaterThanOrEqual(2)
  })

  it('brakes a faster follower while letting its leader and a separate train continue', () => {
    const tracks = line(), remote = line(14, 'remote', 100)
    let fleet = [train(tracks[5], 0, 'follower'), { ...train(tracks[7], 100, 'leader'), actualSpeed: 35, requestedSpeed: 35 }, train(remote[5], 0, 'remote')]
    const leaderStart = referenceX(tracks, fleet[1]), remoteStart = referenceX(remote, fleet[2])
    for (let tick = 0; tick < 60; tick++) {
      fleet = stepFleet([...tracks, ...remote], fleet, .05)
      expect(trainFootprintsConflict(trainFootprint(tracks, fleet[0]), trainFootprint(tracks, fleet[1]), 0)).toBe(false)
    }
    expect(fleet[0].status).toBe('blocked')
    expect(fleet[1].running).toBe(true)
    expect(fleet[2].running).toBe(true)
    expect(referenceX(tracks, fleet[1])).toBeGreaterThan(leaderStart)
    expect(referenceX(remote, fleet[2])).toBeGreaterThan(remoteStart)
  })

  it('keeps equal-speed trains moving on the same railway and ignores separated overpasses', () => {
    const tracks = line(), upper = line(14, 'upper', 0, 60)
    let fleet = [train(tracks[5], 0), train(tracks[7], 0, 'leader'), train(upper[5], 0, 'upper')]
    for (let tick = 0; tick < 20; tick++) fleet = stepFleet([...tracks, ...upper], fleet, .05)
    expect(fleet.every(value => value.running)).toBe(true)
    expect(referenceX(tracks, fleet[1]) - referenceX(tracks, fleet[0])).toBeCloseTo(496)
  })

  it('prevents simultaneous physical crossing entry, regardless of fleet ordering', () => {
    const horizontal = line(), vertical = line(14, 'vertical').map(piece => ({ ...piece, x: 0, y: piece.x, angle: Math.PI / 2 }))
    const tracks = [...horizontal, ...vertical]
    const a = train(horizontal[4], 80, 'a'), b = train(vertical[4], 80, 'b')
    for (const initial of [[a, b], [b, a]]) {
      let fleet = initial
      for (let tick = 0; tick < 35; tick++) {
        fleet = stepFleet(tracks, fleet, .05)
        expect(trainFootprintsConflict(trainFootprint(tracks, fleet[0]), trainFootprint(tracks, fleet[1]), 0)).toBe(false)
      }
      expect(fleet.some(value => value.status === 'blocked')).toBe(true)
      expect(fleet.find(value => value.id === 'a')!.running).toBe(true)
    }
  })

  it('handles high-speed frame stalls and stays on curves across route boundaries', () => {
    const tracks = makeCityLayout()
    let fleet = [train(tracks[3], 230), { ...train(tracks[10], 100, 'two'), type: 'e6' as const }]
    const before = fleet[0].position!, result = stepFleet(tracks, fleet, 600)
    const maximumAdvance = getTrainSpec('e235').maxServiceSpeed / 3.6 * 1000 / 150 * .1
    const expected = advanceTrain(tracks, before, maximumAdvance).position
    expect(result[0].position!.trackId).toBe(expected.trackId)
    expect(result[0].position!.distance).toBeCloseTo(expected.distance, 8)
    fleet = result
    for (let tick = 0; tick < 30; tick++) {
      fleet = stepFleet(tracks, fleet, .05)
      expect(trainFootprint(tracks, fleet[0]).complete).toBe(true)
      expect(trainFootprint(tracks, fleet[1]).complete).toBe(true)
      expect(trainFootprintsConflict(trainFootprint(tracks, fleet[0]), trainFootprint(tracks, fleet[1]), 0)).toBe(false)
    }
  })

  it.each(TRAIN_TYPES)('bounds a stalled frame to 100 ms of %s service-speed motion', type => {
    const tracks = line(30)
    const before = train(tracks[10], 240, 'one', 1, type)
    const result = stepFleet(tracks, [before], 600)[0]
    const expectedDistance = getTrainSpec(type).maxServiceSpeed / 3.6 * 1000 / getTrainSpec(type).scale * .1
    expect(referenceX(tracks, result) - referenceX(tracks, before)).toBeCloseTo(expectedDistance, 8)
    expect(result.actualSpeed).toBe(getTrainSpec(type).maxServiceSpeed)
    expect(trainFootprint(tracks, result).complete).toBe(true)
  })

  it.each(TRAIN_TYPES)('keeps every %s car supported through curve joins at its service maximum', type => {
    const tracks = makeCityLayout()
    let fleet = [train(tracks[3], 230, 'one', 1, type)]
    const distance = getTrainSpec(type).maxServiceSpeed / 3.6 * 1000 / getTrainSpec(type).scale * .1
    for (let tick = 0; tick < 30; tick++) {
      const expected = advanceTrain(tracks, fleet[0].position!, distance).position
      fleet = stepFleet(tracks, fleet, .1)
      expect(fleet[0].position!.trackId).toBe(expected.trackId)
      expect(fleet[0].position!.distance).toBeCloseTo(expected.distance, 7)
      expect(fleet[0].actualSpeed).toBe(getTrainSpec(type).maxServiceSpeed)
      const footprint = trainFootprint(tracks, fleet[0])
      expect(footprint.complete).toBe(true)
      expect(trainFootprintOverlapsItself(footprint)).toBe(false)
    }
  })

  it('stops maximum-speed E5 and E6 head-on approaches before any body contact', () => {
    const tracks = line(30)
    let fleet = [train(tracks[10], 100, 'e5', 1, 'e5'), train(tracks[14], 100, 'e6', -1, 'e6')]
    expect(fleet.every(value => trainFootprint(tracks, value).complete)).toBe(true)
    let previous = fleet.map(value => referenceX(tracks, value))
    for (let tick = 0; tick < 35; tick++) {
      fleet = stepFleet(tracks, fleet, .1)
      expect(trainFootprintsConflict(trainFootprint(tracks, fleet[0]), trainFootprint(tracks, fleet[1]), 0)).toBe(false)
      const positions = fleet.map(value => referenceX(tracks, value))
      const maximumAdvance = getTrainSpec('e5').maxServiceSpeed / 3.6 * 1000 / getTrainSpec('e5').scale * .1
      expect(positions[0] - previous[0]).toBeGreaterThanOrEqual(-1e-6)
      expect(previous[1] - positions[1]).toBeGreaterThanOrEqual(-1e-6)
      expect(positions[0] - previous[0]).toBeLessThanOrEqual(maximumAdvance + 1e-6)
      expect(previous[1] - positions[1]).toBeLessThanOrEqual(maximumAdvance + 1e-6)
      previous = positions
    }
    expect(fleet.every(value => value.status === 'blocked' && value.actualSpeed === 0)).toBe(true)
  })

  it('brakes a maximum-speed E5 follower while its slower E7 leader and remote E6 keep moving', () => {
    const tracks = line(30), remote = line(30, 'remote', 100)
    let fleet = [train(tracks[10], 100, 'follower', 1, 'e5'), { ...train(tracks[14], 100, 'leader', 1, 'e7'), actualSpeed: 65, requestedSpeed: 65 }, train(remote[10], 100, 'remote', 1, 'e6')]
    const leaderStart = referenceX(tracks, fleet[1]), remoteStart = referenceX(remote, fleet[2])
    for (let tick = 0; tick < 35; tick++) {
      fleet = stepFleet([...tracks, ...remote], fleet, .1)
      expect(trainFootprintsConflict(trainFootprint(tracks, fleet[0]), trainFootprint(tracks, fleet[1]), 0)).toBe(false)
    }
    expect(fleet[0].status).toBe('blocked')
    expect(fleet[1].running).toBe(true)
    expect(fleet[2].running).toBe(true)
    expect(fleet[2].actualSpeed).toBe(getTrainSpec('e6').maxServiceSpeed)
    expect(referenceX(tracks, fleet[1])).toBeGreaterThan(leaderStart)
    expect(referenceX(remote, fleet[2]) - remoteStart).toBeCloseTo(getTrainSpec('e6').maxServiceSpeed / 3.6 * 1000 / getTrainSpec('e6').scale * 3.5, 6)
  })

  it('locks a stopped trailing formation on a turnout and permits unoccupied pieces', () => {
    const turnout: Track = { id: 'turnout', kind: 't4r', x: 0, y: 0, angle: 0, bend: 1, switchState: 'straight' }
    const common = attachTrack('s248', 1, endpoints(turnout)[0], 'common')
    const common2 = attachTrack('s248', 1, endpoints(common)[1], 'common2')
    const main = attachTrack('s248', 1, endpoints(turnout)[1], 'main')
    const branch = attachTrack('s248', 1, endpoints(turnout)[2], 'branch')
    const tracks = [turnout, common, common2, main, branch]
    const parked = { ...train(main, 40), actualSpeed: 0, running: false }
    const occupied = occupiedFleetTrackIds(tracks, [parked])
    expect(occupied.has(turnout.id)).toBe(true)
    expect(occupied.has(common.id)).toBe(true)
    expect(occupied.has(branch.id)).toBe(false)
    expect(pathsFor(turnout)).toHaveLength(2)
  })

  it('resolves a braking three-train chain from one snapshot without penetration', () => {
    const tracks = line()
    let fleet = [train(tracks[5], 0, 'rear'), train(tracks[6], 192, 'middle'), { ...train(tracks[8], 136, 'front'), running: false, actualSpeed: 0, status: 'stopped' as const }]
    for (let tick = 0; tick < 60; tick++) {
      fleet = stepFleet(tracks, fleet, .05)
      for (let first = 0; first < fleet.length; first++) for (let second = first + 1; second < fleet.length; second++)
        expect(trainFootprintsConflict(trainFootprint(tracks, fleet[first]), trainFootprint(tracks, fleet[second]), 0)).toBe(false)
    }
    expect(fleet[0].status).toBe('blocked')
    expect(fleet[1].status).toBe('blocked')
    expect(fleet[2].status).toBe('stopped')
  })

  it.each(['x90', 'scissors'])('protects manufactured %s route conflicts and lets one train clear', kind => {
    const junction: Track = { id: 'junction', kind, x: 0, y: 0, angle: 0, bend: 1, switchState: 'branch' }
    const tracks = [junction], starts: Track[] = []
    endpoints(junction).forEach((endpoint, port) => {
      let anchor = endpoint
      for (let piece = 0; piece < 4; piece++) {
        const lead = attachTrack('s248', 1, anchor, `lead-${port}-${piece}`)
        tracks.push(lead); if (!piece) starts[port] = lead
        anchor = endpoints(lead)[1]
      }
    })
    let fleet = [train(starts[0], 140, 'a', -1), train(starts[2], 140, 'b', -1)]
    for (let tick = 0; tick < 65; tick++) {
      fleet = stepFleet(tracks, fleet, .05)
      expect(trainFootprintsConflict(trainFootprint(tracks, fleet[0]), trainFootprint(tracks, fleet[1]), 0)).toBe(false)
      expect(trainFootprint(tracks, fleet[0]).complete).toBe(true)
      expect(trainFootprint(tracks, fleet[1]).complete).toBe(true)
    }
    expect(fleet.some(value => value.status === 'blocked')).toBe(true)
    expect(fleet.some(value => value.running)).toBe(true)
  })

  it.each(['x90', 'scissors'])('protects manufactured %s junctions at 320 km/h across stalled frames', kind => {
    const junction: Track = { id: 'junction', kind, x: 0, y: 0, angle: 0, bend: 1, switchState: 'branch' }
    const tracks = [junction], starts: Track[] = []
    endpoints(junction).forEach((endpoint, port) => {
      let anchor = endpoint
      for (let piece = 0; piece < 8; piece++) {
        const lead = attachTrack('s248', 1, anchor, `lead-${port}-${piece}`)
        // Give a 320 km/h approach enough track to brake before the crossing.
        tracks.push(lead); if (piece === 2) starts[port] = lead
        anchor = endpoints(lead)[1]
      }
    })
    const a = train(starts[0], 180, 'a', -1, 'e5'), b = train(starts[2], 180, 'b', -1, 'e6')
    for (const initial of [[a, b], [b, a]]) {
      let fleet = initial
      for (let tick = 0; tick < 25; tick++) {
        fleet = stepFleet(tracks, fleet, tick === 0 ? 600 : .1)
        expect(trainFootprintsConflict(trainFootprint(tracks, fleet[0]), trainFootprint(tracks, fleet[1]), 0)).toBe(false)
        expect(fleet.every(value => trainFootprint(tracks, value).complete)).toBe(true)
      }
      expect(fleet.some(value => value.status === 'blocked')).toBe(true)
      expect(fleet.find(value => value.id === 'a')!.running).toBe(true)
    }
  })

  it('brakes on a selected turnout merge while the train ahead keeps running', () => {
    const turnout: Track = { id: 'merge', kind: 't4r', x: 0, y: 0, angle: 0, bend: 1, switchState: 'branch' }
    const tracks = [turnout], leads: Track[][] = []
    endpoints(turnout).forEach((endpoint, port) => {
      let anchor = endpoint; leads[port] = []
      for (let index = 0; index < 4; index++) {
        const track = attachTrack('s248', 1, anchor, `merge-${port}-${index}`)
        tracks.push(track); leads[port].push(track); anchor = endpoints(track)[1]
      }
    })
    let fleet = [{ ...train(leads[0][1], 152, 'leader'), actualSpeed: 35, requestedSpeed: 35 }, train(leads[2][0], 80, 'follower', -1)]
    for (let tick = 0; tick < 85; tick++) {
      fleet = stepFleet(tracks, fleet, .05)
      expect(trainFootprintsConflict(trainFootprint(tracks, fleet[0]), trainFootprint(tracks, fleet[1]), 0)).toBe(false)
    }
    expect(fleet[0].running).toBe(true)
    expect(fleet[1].status).toBe('blocked')
  })

  it('measures full-length fleet motion without changing train models', () => {
    for (const count of [2, 4]) {
      const tracks: Track[] = [], fleet: TrainRuntime[] = []
      for (let index = 0; index < count; index++) {
        const loop = makeCityLayout().map(track => ({ ...track, id: `${index}-${track.id}`, y: track.y + index * 1800 }))
        tracks.push(...loop)
        fleet.push({ ...train(loop[3], 180, `train-${index}`), type: (['e5', 'e6', 'e7', 'e235'] as const)[index], carCount: 11, requestedSpeed: 65, actualSpeed: 65 })
      }
      let state = fleet
      const started = performance.now()
      for (let frame = 0; frame < 40; frame++) state = stepFleet(tracks, state, .032)
      const average = (performance.now() - started) / 40
      console.info(`Fleet CPU: ${count} sets × 11 cars, ${average.toFixed(2)} ms per 32 ms frame`)
      expect(state.every(value => value.running)).toBe(true)
    }
  })

  it('stops a long formation before it collides with its own tail entering a tight circuit', () => {
    const tracks = line(8)
    let anchor = endpoints(tracks[tracks.length - 1])[1]
    for (let index = 0; index < 8; index++) {
      const curve = attachTrack('c117', 1, anchor, `tight-${index}`)
      tracks.push(curve); anchor = endpoints(curve)[1]
    }
    let fleet = [{ ...train(tracks[7], 148), carCount: 11 }]
    expect(trainFootprintOverlapsItself(trainFootprint(tracks, fleet[0]))).toBe(false)
    for (let tick = 0; tick < 100 && fleet[0].running; tick++) {
      fleet = stepFleet(tracks, fleet, .1)
      expect(trainFootprintOverlapsItself(trainFootprint(tracks, fleet[0]))).toBe(false)
    }
    expect(fleet[0].status).toBe('blocked')
    expect(fleet[0].stopReason).toContain('curve')
  })
})
