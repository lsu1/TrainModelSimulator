import { describe, expect, it } from 'vitest'
import type { TrainSnapshot } from './fleet'
import { advanceTrain, attachTrack, endpoints, makeCityLayout } from './track'
import type { Track } from './track'
import { bodyVolumesIntersect, sweptTrainFootprintsConflict, trainFootprint, trainFootprintsConflict } from './trainSafety'

const straight: Track = { id: 'straight', kind: 's248', x: 0, y: 0, angle: 0, bend: 1 }
const train = (trackId: string, distance: number, id = 'one', direction: 1 | -1 = 1): TrainSnapshot => ({
  id, name: id, type: 'e235', carCount: 3, requestedSpeed: 65, cabForward: true,
  position: { trackId, distance, direction, route: 0, laps: 0 },
})

describe('moving rolling-stock envelopes', () => {
  it('detects real body ends beyond bogies, with grade and height separation', () => {
    const a = trainFootprint([straight], train('straight', 200))
    const b = trainFootprint([{ ...straight, id: 'other', y: 18 }], train('other', 200, 'two'))
    expect(trainFootprintsConflict(a, b)).toBe(true)
    const raised = { ...straight, id: 'raised', elevation: 60 }
    expect(trainFootprintsConflict(a, trainFootprint([raised], train('raised', 200, 'raised')))).toBe(false)
    const ramp = { ...straight, id: 'ramp', endElevation: 8 }
    const grade = trainFootprint([ramp], train('ramp', 200))
    expect(grade.volumes[0].axes[0].z).toBeGreaterThan(0)
    expect(grade.volumes[0].bounds.maxZ).toBeGreaterThan(a.volumes[0].bounds.maxZ)
    const body = a.volumes[0]
    const noseOnly = { ...body, center: { ...body.center, x: body.center.x + 130 }, bounds: { ...body.bounds, minX: body.bounds.minX + 130, maxX: body.bounds.maxX + 130 } }
    expect(bodyVolumesIntersect(body, noseOnly)).toBe(true)
  })

  it('catches swept head-on contact while preserving equal-speed following gaps', () => {
    const tracks: Track[] = []
    let anchor = { position: { x: -1240, y: 0, z: 0 }, angle: 0 }
    for (let index = 0; index < 10; index++) {
      const track = attachTrack('s248', 1, anchor, `line-${index}`); tracks.push(track)
      const end = endpoints(track)[1]; anchor = { ...end, position: { ...end.position, z: 0 } }
    }
    const left = train(tracks[5].id, 100), right = train(tracks[5].id, 105, 'two', -1)
    const next = (value: TrainSnapshot, distance: number) => ({ ...value, position: advanceTrain(tracks, value.position!, distance).position })
    expect(trainFootprintsConflict(trainFootprint(tracks, left), trainFootprint(tracks, right))).toBe(false)
    expect(sweptTrainFootprintsConflict(trainFootprint(tracks, left), trainFootprint(tracks, next(left, 2)), trainFootprint(tracks, right), trainFootprint(tracks, next(right, 2)))).toBe(true)
    const follower = train(tracks[5].id, 50), leader = train(tracks[7].id, 0, 'leader')
    expect(sweptTrainFootprintsConflict(trainFootprint(tracks, follower), trainFootprint(tracks, next(follower, 2)), trainFootprint(tracks, leader), trainFootprint(tracks, next(leader, 2)))).toBe(false)
  })

  it('uses train-specific tapered noses and preserves exact poses on reversal', () => {
    const tracks = makeCityLayout()
    for (const type of ['e235', 'e5', 'e6', 'e7'] as const) {
      const original = { ...train(tracks[3].id, 200), type }
      const footprint = trainFootprint(tracks, original)
      expect(footprint.complete).toBe(true)
      const reverse = { ...original, cabForward: false, position: { ...original.position!, direction: -1 as const } }
      expect(trainFootprint(tracks, reverse)).toEqual(footprint)
      if (type !== 'e235') {
        const nose = footprint.volumes.filter(volume => volume.carIndex === 0)
        expect(nose).toHaveLength(type === 'e7' ? 7 : 8)
        expect(nose[nose.length - 1].half[1]).toBeLessThan(nose[0].half[1])
      }
    }
  })
})
