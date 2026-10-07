import { describe, expect, it } from 'vitest'
import { advanceConsist, occupiedTrackIds } from './trainMotion'
import { CAR_LENGTH, CAR_SPACING } from './trainModel'
import { BOGIE_OFFSET, COUPLING_LINK_LENGTH, solveConsistPoses } from './consistPose'
import { advanceTrain, attachTrack, endpoints, makeStarterLayout, pointAt, sampleBehind, trackLength } from './track'
import type { Track, TrainPosition } from './track'

const line: Track = { id: 'line', kind: 's248', x: 0, y: 0, angle: 0, bend: 1 }
const reverseAt = (distance: number): TrainPosition => ({ trackId: line.id, distance, direction: -1, route: 0, laps: 0 })
const physical = (position: TrainPosition): TrainPosition => ({ ...position, direction: position.direction === 1 ? -1 : 1 })

function openLine(count: number): Track[] {
  const tracks = [line]
  for (let index = 1; index < count; index += 1) tracks.push(attachTrack('s248', 1, endpoints(tracks[index - 1])[1], `line-${index}`))
  return tracks
}

describe('whole-train reverse motion', () => {
  it('delegates forward travel, including exact open-end stopping', () => {
    const position = { ...reverseAt(110), direction: 1 as const }
    expect(advanceConsist([line], position, 1_000, true, 11)).toEqual(advanceTrain([line], position, 1_000))
  })

  it('stops an already overhanging short-line body with its complete rear bogie at the rail end', () => {
    const position = reverseAt(120)
    const result = advanceConsist([line], position, 200, false, 11)
    expect(result.stopped).toBe(true)
    expect(result.position.distance).toBeCloseTo(CAR_LENGTH / 2 + BOGIE_OFFSET)
    expect(result.position.direction).toBe(-1)
    expect(result.position.route).toBe(0)
    const car = solveConsistPoses([line], result.position, false, 11).cars[0]
    expect(car).not.toBeNull()
    expect(car!.rearBogie.x).toBeCloseTo(0)
    expect(car!.frontBogie.x).toBeCloseTo(2 * BOGIE_OFFSET)
    expect(car!.center.angle).toBeCloseTo(0)
    expect(car!.rearEnd.x).toBeLessThan(0)
    expect(solveConsistPoses([line], result.position, false, 11).cars[1]).toBeNull()
  })

  it('stops the rear body at the rail end when the whole visible car fits', () => {
    const result = advanceConsist([line], reverseAt(180), 200, false, 1)
    expect(result.stopped).toBe(true)
    expect(result.position.distance).toBeCloseTo(CAR_LENGTH)
    expect(sampleBehind([line], physical(result.position), CAR_LENGTH)!.x).toBeCloseTo(0)
    expect(sampleBehind([line], physical(result.position), CAR_LENGTH / 2)!.x).toBeCloseTo(CAR_LENGTH / 2)
  })

  it('keeps a full three-car formation on an open railway across piece joins', () => {
    const tracks = openLine(4)
    const position: TrainPosition = { trackId: tracks[2].id, distance: 154, direction: -1, route: 0, laps: 0 }
    const rearOffset = CAR_LENGTH + 2 * CAR_SPACING
    const result = advanceConsist(tracks, position, 800, false, 3)
    expect(result.stopped).toBe(true)
    const reference = pointAt(tracks.find(track => track.id === result.position.trackId)!, result.position.distance)
    expect(reference.x).toBeCloseTo(rearOffset)
    for (let index = 0; index < 3; index += 1) expect(sampleBehind(tracks, physical(result.position), CAR_LENGTH / 2 + index * CAR_SPACING)).not.toBeNull()
    expect(sampleBehind(tracks, physical(result.position), rearOffset)!.x).toBeCloseTo(0)
  })

  it('recomputes the curved tail span when reversing from straights toward an open curve end', () => {
    const tracks: Track[] = []
    let anchor = { position: { x: 0, y: 0, z: 0 }, angle: 0 }
    for (const kind of ['c216', 'c216', 'c216', 'c216', 's248', 's248', 's248']) {
      const track = attachTrack(kind, 1, anchor, `reverse-curve-${tracks.length}`)
      tracks.push(track)
      const end = endpoints(track)[1]
      anchor = { ...end, position: { ...end.position, z: end.position.z ?? 0 } }
    }
    const position: TrainPosition = { trackId: tracks[6].id, distance: 180, direction: -1, laps: 0 }
    const initial = solveConsistPoses(tracks, position, false, 3)
    expect(initial.rearOffset).toBeCloseTo(CAR_LENGTH + 2 * CAR_SPACING, 6)
    const result = advanceConsist(tracks, position, 2_000, false, 3)
    expect(result.stopped).toBe(true)
    const poses = solveConsistPoses(tracks, result.position, false, 3)
    expect(poses.cars.every(Boolean)).toBe(true)
    const bogieArc = 2 * 216 * Math.asin(BOGIE_OFFSET / 216)
    const couplingArc = 2 * 216 * Math.asin(COUPLING_LINK_LENGTH / (2 * 216))
    const curvedSpan = CAR_LENGTH - 2 * BOGIE_OFFSET + 3 * bogieArc + 2 * couplingArc
    expect(poses.rearOffset).toBeCloseTo(curvedSpan, 6)
    expect(poses.rearOffset).toBeGreaterThan(initial.rearOffset + 1)
    const tail = sampleBehind(tracks, physical(result.position), poses.rearOffset)
    expect(tail).not.toBeNull()
    expect(tail!.x).toBeCloseTo(0, 6)
    expect(tail!.y).toBeCloseTo(0, 6)
    const again = advanceConsist(tracks, result.position, 10, false, 3)
    expect(again.stopped).toBe(true)
    expect(again.position.distance).toBeCloseTo(result.position.distance, 6)
  })

  it('moves normally before the rear boundary and remains stopped at that boundary', () => {
    const before = advanceConsist([line], reverseAt(180), 10, false, 1)
    expect(before.stopped).toBe(false)
    expect(before.position.distance).toBe(170)
    const stopped = advanceConsist([line], before.position, 80, false, 1)
    const again = advanceConsist([line], stopped.position, 10, false, 1)
    expect(again.stopped).toBe(true)
    expect(again.position.distance).toBeCloseTo(stopped.position.distance)
  })

  it('preserves the consist orientation across a piece joined through its far end', () => {
    const opposite: Track = { ...line, id: 'opposite', x: 496, angle: Math.PI }
    const tracks = [line, opposite]
    const position: TrainPosition = { trackId: opposite.id, distance: 140, direction: 1, route: 0, laps: 0 }
    const result = advanceConsist(tracks, position, 500, false, 1)
    expect(result.stopped).toBe(true)
    expect(result.position.trackId).toBe(line.id)
    expect(result.position.direction).toBe(-1)
    expect(result.position.distance).toBeCloseTo(CAR_LENGTH)
    const car = sampleBehind(tracks, physical(result.position), CAR_LENGTH / 2)!
    expect(car.x).toBeCloseTo(CAR_LENGTH / 2)
    expect(car.angle).toBeCloseTo(0)
  })

  it('allows another complete car to appear across an accepted small overlapping join', () => {
    const tracks: Track[] = []
    let anchor = { position: { x: 0, y: 0, z: 0 }, angle: 0 }
    for (const kind of ['s186', 's64', 's29', 's45-5', 's38', 's248']) {
      const track = attachTrack(kind, 1, anchor, `overlap-${tracks.length}`)
      tracks.push(track)
      const end = endpoints(track)[1]
      anchor = { ...end, position: { ...end.position, z: end.position.z ?? 0 } }
    }
    // The 0.2 mm overlap is inside the accepted 0.25 mm connection tolerance.
    // Its small backward-traversal jump makes the third rear bogie fit.
    tracks[5].x -= .2
    const position: TrainPosition = { trackId: tracks[5].id, distance: 22.96, direction: -1, laps: 0 }
    expect(solveConsistPoses(tracks, position, false, 3).cars.filter(Boolean)).toHaveLength(2)
    const expected = advanceTrain(tracks, position, .02)
    const result = advanceConsist(tracks, position, .02, false, 3)
    expect(result).toEqual(expected)
    expect(result.stopped).toBe(false)
    const poses = solveConsistPoses(tracks, result.position, false, 3)
    expect(poses.cars.filter(Boolean)).toHaveLength(3)
    // The newly placed third body may overhang; only the existing second
    // body's stopping boundary applies to this reverse step.
    expect(sampleBehind(tracks, physical(result.position), poses.rearOffset)).toBeNull()
    expect(sampleBehind(tracks, physical(result.position), poses.cars[1]!.rearOffset + CAR_LENGTH / 2 - BOGIE_OFFSET)).not.toBeNull()
  })

  it('leaves reverse traversal of a closed circuit unchanged, including large steps', () => {
    const tracks = makeStarterLayout('oval')
    const position: TrainPosition = { trackId: tracks[4].id, distance: 80, direction: -1, route: 0, laps: 0 }
    const circumference = tracks.reduce((sum, track) => sum + trackLength(track), 0)
    for (const distance of [10, circumference + 300, circumference * 1_000 + 15]) {
      expect(advanceConsist(tracks, position, distance, false, 11)).toEqual(advanceTrain(tracks, position, distance))
    }
  })

  it('uses height-aware rear poses on a gradient and preserves the elevated reference', () => {
    const ramp = { ...line, elevation: 20, endElevation: 80 }
    const result = advanceConsist([ramp], reverseAt(180), 200, false, 1)
    expect(result.stopped).toBe(true)
    expect(sampleBehind([ramp], physical(result.position), CAR_LENGTH)!.z).toBeCloseTo(20)
    expect(sampleBehind([ramp], physical(result.position), CAR_LENGTH / 2)!.z).toBeCloseTo(20 + 60 * (CAR_LENGTH / 2) / 248)
  })

  it('allows movement when no car fits yet and treats nonpositive travel consistently', () => {
    const short = { ...line, kind: 's29' }
    const position = { ...reverseAt(15), direction: 1 as const }
    expect(advanceConsist([short], position, 5, false, 11)).toEqual(advanceTrain([short], position, 5))
    expect(advanceConsist([line], reverseAt(110), 200, false, 11)).toEqual(advanceTrain([line], reverseAt(110), 200))
    expect(advanceConsist([line], reverseAt(180), 0, false, 3)).toEqual(advanceTrain([line], reverseAt(180), 0))
    expect(advanceConsist([line], reverseAt(180), Number.POSITIVE_INFINITY, false, 3)).toEqual(advanceTrain([line], reverseAt(180), Number.POSITIVE_INFINITY))
  })
})

describe('track occupancy of the visible formation', () => {
  it('marks every piece along the full train span and leaves nearby unoccupied tracks free', () => {
    const tracks = openLine(8)
    const position: TrainPosition = { trackId: tracks[5].id, distance: 180, direction: 1, route: 0, laps: 0 }
    expect([...occupiedTrackIds(tracks, position, true, 6)].sort()).toEqual(tracks.slice(2, 6).map(track => track.id).sort())
  })

  it('keeps the same occupied pieces immediately after reversal without moving the cars', () => {
    const tracks = openLine(8)
    const position: TrainPosition = { trackId: tracks[5].id, distance: 180, direction: 1, route: 0, laps: 0 }
    const original = occupiedTrackIds(tracks, position, true, 6)
    expect(occupiedTrackIds(tracks, { ...position, direction: -1 }, false, 6)).toEqual(original)
  })

  it('excludes nonexistent rail when a short open line shows only part of a train', () => {
    const tracks = openLine(2)
    const position: TrainPosition = { trackId: tracks[1].id, distance: 100, direction: 1, route: 0, laps: 0 }
    expect(occupiedTrackIds(tracks, position, true, 11)).toEqual(new Set(tracks.map(track => track.id)))
    expect(occupiedTrackIds([], position, true, 11).size).toBe(0)
  })

  it('records a turnout and selected branch under the rear of the train, without marking the unused lead', () => {
    const turnout: Track = { ...line, id: 'turnout', kind: 't4r', switchState: 'branch' }
    const common = attachTrack('s248', 1, endpoints(turnout)[0], 'common')
    const main = attachTrack('s248', 1, endpoints(turnout)[1], 'main')
    const branch = attachTrack('s248', 1, endpoints(turnout)[2], 'branch')
    const position: TrainPosition = { trackId: branch.id, distance: 80, direction: 1, route: 0, laps: 0 }
    expect(occupiedTrackIds([turnout, common, main, branch], position, true, 3)).toEqual(new Set([branch.id, turnout.id, common.id]))
  })

  it('keeps a turnout locked when curved rigid bodies put the tail beyond nominal straight spacing', () => {
    const turnout: Track = { ...line, id: 'curved-tail-turnout', kind: 't4r', switchState: 'branch' }
    const common = attachTrack('s248', 1, endpoints(turnout)[0], 'curved-tail-common')
    const unused = attachTrack('s248', 1, endpoints(turnout)[1], 'curved-tail-unused')
    const curves: Track[] = []
    let anchor = endpoints(turnout)[2]
    for (let index = 0; index < 3; index += 1) {
      const curve = attachTrack('c216', 1, anchor, `curved-tail-${index}`)
      curves.push(curve)
      anchor = endpoints(curve)[1]
    }
    const tracks = [turnout, common, unused, ...curves]
    const nominalSpan = CAR_LENGTH + 2 * CAR_SPACING
    const position = advanceTrain(tracks, { trackId: curves[0].id, distance: 0, direction: 1, laps: 0 }, nominalSpan + 1).position
    // The old fixed span finishes 1 mm beyond the turnout and misses its lock.
    const fixedTail = sampleBehind(tracks, position, nominalSpan)!
    const curveStart = endpoints(curves[0])[0].position
    expect(Math.hypot(fixedTail.x - curveStart.x, fixedTail.y - curveStart.y)).toBeCloseTo(1, 3)
    const poses = solveConsistPoses(tracks, position, true, 3)
    expect(poses.rearOffset).toBeGreaterThan(nominalSpan + 1)
    expect(occupiedTrackIds(tracks, position, true, 3)).toEqual(new Set([turnout.id, ...curves.map(curve => curve.id)]))
  })
})
