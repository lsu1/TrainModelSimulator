import { describe, expect, it } from 'vitest'
import { advanceConsist, occupiedTrackIds } from './trainMotion'
import { CAR_LENGTH, CAR_SPACING } from './trainModel'
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

  it('stops a partially visible short-line train with its visible car center at the rail end', () => {
    const position = reverseAt(110)
    const result = advanceConsist([line], position, 200, false, 11)
    expect(result.stopped).toBe(true)
    expect(result.position.distance).toBeCloseTo(CAR_LENGTH / 2)
    expect(result.position.direction).toBe(-1)
    expect(result.position.route).toBe(0)
    const car = sampleBehind([line], physical(result.position), CAR_LENGTH / 2)
    expect(car).not.toBeNull()
    expect(car!.x).toBeCloseTo(0)
    expect(car!.angle).toBeCloseTo(0)
    expect(sampleBehind([line], physical(result.position), CAR_LENGTH / 2 + CAR_SPACING)).toBeNull()
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
})
