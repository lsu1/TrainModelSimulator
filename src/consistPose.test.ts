import { describe, expect, it } from 'vitest'
import { BOGIE_OFFSET, COUPLING_HEIGHT, COUPLING_LINK_LENGTH, solveConsistPoses } from './consistPose'
import type { CarPose, PoseVector } from './consistPose'
import { advanceTrain, attachTrack, endpoints, makeStarterLayout, pointAt, sampleBehind, trackLength } from './track'
import type { Track, TrainPosition } from './track'
import { CAR_LENGTH, CAR_SPACING } from './trainModel'
import { getCouplingLinkLength, getTrainCarSpec } from './trains'
import type { TrainType } from './trains'

function distance(a: PoseVector, b: PoseVector): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

function chain(kinds: string[]): Track[] {
  const tracks: Track[] = []
  let anchor = { position: { x: 0, y: 0, z: 0 }, angle: 0 }
  for (const kind of kinds) {
    const track = attachTrack(kind, 1, anchor, `piece-${tracks.length}`)
    tracks.push(track)
    anchor = { ...endpoints(track)[1], position: { ...endpoints(track)[1].position, z: endpoints(track)[1].position.z ?? 0 } }
  }
  return tracks
}

function reference(track: Track, distance = 180, direction: 1 | -1 = 1, route = 0): TrainPosition {
  return { trackId: track.id, distance, direction, route, laps: 0 }
}

function complete(cars: (CarPose | null)[]): CarPose[] {
  expect(cars.every(Boolean)).toBe(true)
  return cars as CarPose[]
}

function checkRigid(cars: CarPose[]): void {
  for (const car of cars) {
    expect(distance(car.frontBogie, car.rearBogie)).toBeCloseTo(2 * BOGIE_OFFSET, 6)
    expect(distance(car.frontEnd, car.rearEnd)).toBeCloseTo(CAR_LENGTH, 7)
    expect(car.center.x).toBeCloseTo((car.frontBogie.x + car.rearBogie.x) / 2, 8)
    expect(car.center.y).toBeCloseTo((car.frontBogie.y + car.rearBogie.y) / 2, 8)
    expect(car.center.z).toBeCloseTo((car.frontBogie.z + car.rearBogie.z) / 2, 8)
    expect(car.frontCoupling.z - car.frontBogie.z).toBeCloseTo(COUPLING_HEIGHT, 8)
  }
  for (let index = 1; index < cars.length; index += 1) {
    expect(distance(cars[index - 1].rearCoupling, cars[index].frontCoupling)).toBeCloseTo(COUPLING_LINK_LENGTH, 6)
  }
}

/** Separating-axis test for the actual 133.3 × 19.56 mm stainless shells. */
function bodiesOverlap(a: CarPose, b: CarPose): boolean {
  const halfWidth = 9.78
  const axes = [
    { x: a.direction.x, y: a.direction.y }, { x: -a.direction.y, y: a.direction.x },
    { x: b.direction.x, y: b.direction.y }, { x: -b.direction.y, y: b.direction.x },
  ]
  return axes.every(axis => {
    const radius = (car: CarPose) => CAR_LENGTH / 2 * Math.abs(axis.x * car.direction.x + axis.y * car.direction.y)
      + halfWidth * Math.abs(-axis.x * car.direction.y + axis.y * car.direction.x)
    const separation = Math.abs(axis.x * (a.center.x - b.center.x) + axis.y * (a.center.y - b.center.y))
    return separation < radius(a) + radius(b) - 1e-7
  })
}

describe('rigid, connected consist poses', () => {
  it('retains straight lengths and spacing for three through eleven cars', () => {
    const tracks = chain(Array(9).fill('s248'))
    const position = reference(tracks[8])
    const leading = pointAt(tracks[8], position.distance)
    for (let count = 3; count <= 11; count += 1) {
      const poses = solveConsistPoses(tracks, position, true, count)
      const cars = complete(poses.cars)
      checkRigid(cars)
      expect(poses.couplings).toHaveLength(count - 1)
      expect(poses.rearOffset).toBeCloseTo(CAR_LENGTH + (count - 1) * CAR_SPACING, 6)
      for (const [index, car] of cars.entries()) {
        expect(car.center.x).toBeCloseTo(leading.x - CAR_LENGTH / 2 - index * CAR_SPACING, 6)
        expect(car.center.y).toBeCloseTo(0, 8)
        expect(car.center.angle).toBeCloseTo(0, 8)
      }
      for (const coupling of poses.couplings) {
        expect(distance(coupling.frontPin, coupling.point)).toBeCloseTo(COUPLING_LINK_LENGTH / 2, 6)
        expect(distance(coupling.rearPin, coupling.point)).toBeCloseTo(COUPLING_LINK_LENGTH / 2, 6)
      }
    }
  })

  it.each([216, 249, 282, 315])('matches analytical bogie and coupling chords on an R%i circle', radius => {
    const tracks = chain(Array(8).fill(`c${radius}`))
    const position = reference(tracks[0], 40)
    const poses = solveConsistPoses(tracks, position, true, 3)
    const cars = complete(poses.cars)
    const bogieArc = 2 * radius * Math.asin(BOGIE_OFFSET / radius)
    const couplingArc = 2 * radius * Math.asin(COUPLING_LINK_LENGTH / (2 * radius))
    const centerRadius = Math.sqrt(radius ** 2 - BOGIE_OFFSET ** 2)
    checkRigid(cars)
    for (const [index, car] of cars.entries()) {
      const frontOffset = CAR_LENGTH / 2 - BOGIE_OFFSET + index * (bogieArc + couplingArc)
      expect(car.frontOffset).toBeCloseTo(frontOffset, 6)
      expect(car.rearOffset).toBeCloseTo(frontOffset + bogieArc, 6)
      expect(Math.hypot(car.center.x, car.center.y - radius)).toBeCloseTo(centerRadius, 6)
      // The midpoint is inside the track circle by the rigid-body sagitta.
      expect(radius - Math.hypot(car.center.x, car.center.y - radius)).toBeGreaterThan(2)
    }
    for (let index = 1; index < cars.length; index += 1) expect(bodiesOverlap(cars[index - 1], cars[index])).toBe(false)
  })

  it('keeps all bogies on the chosen turnout/curve route and poses continuous across its joins', () => {
    const tracks = chain([...Array(4).fill('s248'), 't4r'])
    const turnout = tracks[4]
    turnout.switchState = 'branch'
    let anchor = endpoints(turnout)[2]
    for (const kind of ['c282', 'c282', 's248']) {
      const track = attachTrack(kind, 1, anchor, `branch-${tracks.length}`)
      tracks.push(track)
      anchor = endpoints(track)[1]
    }
    const unused = attachTrack('s248', 1, endpoints(turnout)[1], 'unused-straight-route')
    tracks.push(unused)
    let position = reference(turnout, 0, 1, 1)
    let previous: CarPose[] | null = null
    for (let step = 0; step <= 180; step += 1) {
      const cars = complete(solveConsistPoses(tracks, position, true, 3).cars)
      checkRigid(cars)
      for (const [index, car] of cars.entries()) {
        expect(car.frontBogie).toEqual(sampleBehind(tracks, position, car.frontOffset))
        expect(car.rearBogie).toEqual(sampleBehind(tracks, position, car.rearOffset))
        if (previous) {
          expect(distance(car.center, previous[index].center)).toBeLessThan(4.5)
          const angleChange = Math.atan2(Math.sin(car.center.angle - previous[index].center.angle), Math.cos(car.center.angle - previous[index].center.angle))
          expect(Math.abs(angleChange)).toBeLessThan(.04)
        }
        if (index) expect(bodiesOverlap(cars[index - 1], car)).toBe(false)
      }
      previous = cars
      position = advanceTrain(tracks, position, 4).position
    }
  })

  it('preserves every physical pose and connection immediately on reversing', () => {
    const tracks = makeStarterLayout('compact')
    const position = reference(tracks[4], 100)
    for (const count of [3, 6, 11]) {
      const forward = solveConsistPoses(tracks, position, true, count)
      const reversed = solveConsistPoses(tracks, { ...position, direction: -1 }, false, count)
      expect(reversed).toEqual(forward)
    }
  })

  it('keeps eleven rigid shells separate around an oval including straight/curve transitions', () => {
    const tracks = makeStarterLayout('compact')
    let position = reference(tracks[0], 0)
    const circuit = tracks.reduce((sum, track) => sum + trackLength(track), 0)
    for (let traveled = 0; traveled < circuit; traveled += 35) {
      const cars = complete(solveConsistPoses(tracks, position, true, 11).cars)
      checkRigid(cars)
      for (let first = 0; first < cars.length; first += 1) {
        for (let second = first + 1; second < cars.length; second += 1) expect(bodiesOverlap(cars[first], cars[second])).toBe(false)
      }
      position = advanceTrain(tracks, position, 35).position
    }
  })

  it('preserves rigid 3D spans and fixed connections on inclined straight track', () => {
    const tracks: Track[] = []
    let anchor = { position: { x: 0, y: 0, z: 20 }, angle: .3 }
    for (let index = 0; index < 5; index += 1) {
      const track = { ...attachTrack('s248', 1, anchor, `ramp-${index}`), elevation: 20 + index * 8, endElevation: 28 + index * 8 }
      tracks.push(track)
      const end = endpoints(track)[1]
      anchor = { ...end, position: { ...end.position, z: end.position.z ?? 0 } }
    }
    const cars = complete(solveConsistPoses(tracks, reference(tracks[4]), true, 6).cars)
    checkRigid(cars)
    for (const car of cars) {
      expect(car.pitch).toBeCloseTo(Math.asin(8 / 248), 8)
      expect(car.frontBogie.z).toBeGreaterThan(car.rearBogie.z)
      expect(car.direction.z).toBeCloseTo(8 / 248, 8)
    }
  })

  it('solves a valid chord immediately before an open end without extrapolating any bogie', () => {
    const track: Track = { id: 'short-curve', kind: 'c216', x: 0, y: 0, angle: 0, bend: 1 }
    // Rear span requires about88 mm, and the initial wider bracket exceeds
    // the available90 mm. The existing endpoint still contains a valid root.
    const position = reference(track, CAR_LENGTH / 2 - BOGIE_OFFSET + 90)
    const poses = solveConsistPoses([track], position, true, 3)
    expect(poses.cars[0]).not.toBeNull()
    expect(poses.cars[1]).toBeNull()
    expect(poses.cars[2]).toBeNull()
    expect(poses.couplings).toHaveLength(0)
    checkRigid([poses.cars[0]!])
    expect(poses.cars[0]!.rearBogie).toEqual(sampleBehind([track], position, poses.cars[0]!.rearOffset))
    expect(poses.cars[0]!.rearBogie.x).toBeGreaterThan(0)
  })

  it('leaves incomplete open-end cars hidden and handles absent tracks or empty formations', () => {
    const tracks = chain(['s248'])
    expect(solveConsistPoses(tracks, reference(tracks[0], 110), true, 3).cars).toEqual([null, null, null])
    const partial = solveConsistPoses(tracks, reference(tracks[0], 200), true, 3)
    expect(partial.cars[0]).not.toBeNull()
    expect(partial.cars.slice(1)).toEqual([null, null])
    expect(solveConsistPoses([], reference(tracks[0]), true, 3).cars).toEqual([null, null, null])
    expect(solveConsistPoses(tracks, reference(tracks[0]), true, 0)).toEqual({ cars: [], couplings: [], rearOffset: 0 })
  })
})

describe.each<TrainType>(['e5', 'e6', 'e7'])('%s Shinkansen rigid formation', trainType => {
  function checkFormation(cars: CarPose[], count: number): void {
    for (const [index, car] of cars.entries()) {
      const spec = getTrainCarSpec(trainType, index, count)
      expect(distance(car.frontBogie, car.rearBogie)).toBeCloseTo(2 * spec.bogieOffset, 6)
      expect(distance(car.frontEnd, car.rearEnd)).toBeCloseTo(spec.length, 7)
      expect(car.frontCoupling.z - car.frontBogie.z).toBeCloseTo(COUPLING_HEIGHT, 8)
      if (index) {
        const link = getCouplingLinkLength(trainType, index - 1, count)
        expect(distance(cars[index - 1].rearCoupling, car.frontCoupling)).toBeCloseTo(link, 6)
      }
    }
  }

  it('keeps the longer end cabs, shorter middle cars and nominal straight gaps', () => {
    const tracks = chain(Array(12).fill('s248'))
    const position = reference(tracks[11], 200)
    const leading = pointAt(tracks[11], position.distance)
    expect(getTrainCarSpec(trainType, 0, 3).length).toBeGreaterThan(getTrainCarSpec(trainType, 1, 3).length)
    for (const count of [3, 7, 11]) {
      const poses = solveConsistPoses(tracks, position, true, count, trainType)
      const cars = complete(poses.cars)
      checkFormation(cars, count)
      let previousRear = leading.x
      for (const [index, car] of cars.entries()) {
        const spec = getTrainCarSpec(trainType, index, count)
        expect(car.frontEnd.x).toBeCloseTo(previousRear - (index ? 4.2 : 0), 6)
        expect(car.rearEnd.x).toBeCloseTo(car.frontEnd.x - spec.length, 6)
        previousRear = car.rearEnd.x
      }
      expect(poses.rearOffset).toBeCloseTo(leading.x - previousRear, 6)
      expect(poses.couplings).toHaveLength(count - 1)
      for (const coupling of poses.couplings) {
        const halfLink = getCouplingLinkLength(trainType, coupling.frontCarIndex, count) / 2
        expect(distance(coupling.frontPin, coupling.point)).toBeCloseTo(halfLink, 6)
        expect(distance(coupling.rearPin, coupling.point)).toBeCloseTo(halfLink, 6)
      }
    }
  })

  it('solves each cab and middle bogie chord analytically on curved rail', () => {
    const radius = 315
    const count = 7
    const tracks = chain(Array(8).fill('c315'))
    const poses = solveConsistPoses(tracks, reference(tracks[0], 40), true, count, trainType)
    const cars = complete(poses.cars)
    checkFormation(cars, count)
    const first = getTrainCarSpec(trainType, 0, count)
    let expectedFront = first.length / 2 - first.bogieOffset
    for (const [index, car] of cars.entries()) {
      const spec = getTrainCarSpec(trainType, index, count)
      const bogieArc = 2 * radius * Math.asin(spec.bogieOffset / radius)
      expect(car.frontOffset).toBeCloseTo(expectedFront, 6)
      expect(car.rearOffset).toBeCloseTo(expectedFront + bogieArc, 6)
      expect(Math.hypot(car.center.x, car.center.y - radius)).toBeCloseTo(Math.sqrt(radius ** 2 - spec.bogieOffset ** 2), 6)
      expectedFront += bogieArc
      if (index + 1 < count) {
        expectedFront += 2 * radius * Math.asin(getCouplingLinkLength(trainType, index, count) / (2 * radius))
      }
    }
    const last = getTrainCarSpec(trainType, count - 1, count)
    expect(poses.rearOffset).toBeCloseTo(expectedFront + last.length / 2 - last.bogieOffset, 6)
  })

  it('preserves all variable-length poses and couplings on immediate reversal', () => {
    const tracks = chain(Array(8).fill('c315'))
    const position = reference(tracks[1], 80)
    const original = solveConsistPoses(tracks, position, true, 7, trainType)
    complete(original.cars)
    expect(solveConsistPoses(tracks, { ...position, direction: -1 }, false, 7, trainType)).toEqual(original)
  })

  it('keeps long cabs and intermediates rigid and connected across elevated grades', () => {
    const tracks: Track[] = []
    let anchor = { position: { x: 0, y: 0, z: 20 }, angle: .3 }
    for (let index = 0; index < 8; index += 1) {
      const track = { ...attachTrack('s248', 1, anchor, `shinkansen-ramp-${index}`), elevation: 20 + index * 8, endElevation: 28 + index * 8 }
      tracks.push(track)
      const end = endpoints(track)[1]
      anchor = { ...end, position: { ...end.position, z: end.position.z ?? 0 } }
    }
    const cars = complete(solveConsistPoses(tracks, reference(tracks[7], 200), true, 7, trainType).cars)
    checkFormation(cars, 7)
    for (const car of cars) {
      expect(car.pitch).toBeCloseTo(Math.asin(8 / 248), 8)
      expect(car.frontBogie.z).toBeGreaterThan(car.rearBogie.z)
      expect(car.direction.z).toBeCloseTo(8 / 248, 8)
    }
  })
})
