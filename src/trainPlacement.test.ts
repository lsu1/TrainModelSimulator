import { describe, expect, it } from 'vitest'
import type { TrainSnapshot } from './fleet'
import { attachTrack, endpoints, makeCityLayout, pathsFor, pointAt, trackLength } from './track'
import type { Track } from './track'
import { closestTrainPlacement, findTrainPlacement, validateTrainPlacement } from './trainPlacement'
import { trainFootprint } from './trainSafety'

function line(count = 10, kind = 's248', prefix = 'line', y = 0, elevation = 0): Track[] {
  const result: Track[] = []
  let anchor = { position: { x: -1240, y, z: elevation }, angle: 0 }
  for (let index = 0; index < count; index++) {
    const track = attachTrack(kind, 1, anchor, `${prefix}-${index}`)
    result.push(track); const end = endpoints(track)[1]
    anchor = { ...end, position: { ...end.position, z: end.position.z ?? 0 } }
  }
  return result
}
function train(track: Track, distance = 100, direction: 1 | -1 = 1, id = 'one'): TrainSnapshot {
  return { id, name: id, type: 'e235', carCount: 3, cabForward: true, requestedSpeed: 65, position: { trackId: track.id, distance, direction, route: 0, laps: 0 } }
}

describe('whole-train placement', () => {
  it('permits opposing trains with separate bodies on the same piece', () => {
    const tracks = line(), left = train(tracks[5], 20), right = train(tracks[5], 200, -1, 'two')
    expect(left.position!.trackId).toBe(right.position!.trackId)
    expect(validateTrainPlacement(tracks, right, [left]).allowed).toBe(true)
    expect(validateTrainPlacement(tracks, { ...right, position: { ...right.position!, distance: 21 } }, [left]).allowed).toBe(false)
  })

  it.each(['e235', 'e5', 'e6', 'e7'] as const)('fits complete %s cars and rejects short rails', type => {
    const tracks = line(), candidate = { ...train(tracks[5]), type }
    expect(validateTrainPlacement(tracks, candidate, []).allowed).toBe(true)
    const short = line(1)
    const partial = { ...candidate, position: { ...candidate.position!, trackId: short[0].id, distance: 180 } }
    expect(validateTrainPlacement(short, partial, []).allowed).toBe(false)
    expect(validateTrainPlacement(short, partial, [], { allowPartial: true }).allowed).toBe(true)
    expect(trainFootprint(short, partial).visibleCars).toBe(1)
  })

  it('rejects reversed partial placement, bad distance, inactive switch routes and self wrapping', () => {
    const short = line(1)
    expect(validateTrainPlacement(short, train(short[0], 100, -1), []).allowed).toBe(false)
    expect(validateTrainPlacement(short, train(short[0], 999), []).allowed).toBe(false)
    const turnout: Track = { ...short[0], kind: 't4r', switchState: 'straight' }
    expect(validateTrainPlacement([turnout], { ...train(turnout), position: { ...train(turnout).position!, route: 1 } }, []).reason).toContain('other route')
    const tinyLoop: Track[] = []
    let anchor = { position: { x: 0, y: 0, z: 0 }, angle: 0 }
    for (let index = 0; index < 8; index++) {
      const track = attachTrack('c117', 1, anchor, `tiny-${index}`)
      tinyLoop.push(track); const end = endpoints(track)[1]
      anchor = { ...end, position: { ...end.position, z: 0 } }
    }
    expect(validateTrainPlacement(tinyLoop, { ...train(tinyLoop[0], 20), carCount: 11 }, []).reason).toContain('too long')
  })

  it('finds separate safe instances automatically without moving existing stock', () => {
    const tracks = makeCityLayout(), candidate = { ...train(tracks[0]), type: 'e5' as const }
    const firstPosition = findTrainPlacement(tracks, candidate, [])
    expect(firstPosition).not.toBeNull()
    const first = { ...candidate, position: firstPosition }
    const original = JSON.stringify(first)
    const second = { ...candidate, id: 'two' }
    const secondPosition = findTrainPlacement(tracks, second, [first])
    expect(secondPosition).not.toBeNull()
    expect(validateTrainPlacement(tracks, { ...second, position: secondPosition }, [first]).allowed).toBe(true)
    expect(JSON.stringify(first)).toBe(original)
    expect(findTrainPlacement(line(1), candidate, [])).toBeNull()
  })

  it('picks the actual double-track lane and height, including curved lanes', () => {
    for (const kind of ['ds248', 'dc414']) {
      const track: Track = { id: kind, kind, x: 30, y: -20, angle: .4, elevation: 60, bend: 1 }
      for (const route of pathsFor(track)) {
        const distance = route.length * .6, target = pointAt(track, distance, route.route)
        const result = closestTrainPlacement([track], track.id, target, -1)
        expect(result?.route).toBe(route.route)
        expect(result?.distance).toBeCloseTo(distance, 3)
        expect(result?.direction).toBe(-1)
      }
    }
    expect(closestTrainPlacement([], 'absent', { x: 0, y: 0, z: 0 }, 1)).toBeNull()
  })

  it('permits parallel lanes and vertically separated railways, but rejects bodies at a crossing', () => {
    const doubles = line(7, 'ds248'), outer = train(doubles[5], 100)
    const inner = { ...train(doubles[5], 100, 1, 'two'), position: { ...train(doubles[5], 100).position!, route: 1 } }
    expect(validateTrainPlacement(doubles, inner, [outer]).allowed).toBe(true)
    const lower = line(7, 's248', 'lower'), upper = line(7, 's248', 'upper', 0, 60)
    expect(validateTrainPlacement([...lower, ...upper], train(upper[5], 100, 1, 'upper'), [train(lower[5], 100)]).allowed).toBe(true)
    const crossed = line(7, 's248', 'cross').map(piece => ({ ...piece, x: 0, y: piece.x, angle: Math.PI / 2 }))
    expect(validateTrainPlacement([...lower, ...crossed], train(crossed[5], 100, 1, 'cross'), [train(lower[5], 100)]).allowed).toBe(false)
    expect(trackLength(doubles[0])).toBe(248)
  })
})
