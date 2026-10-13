import { describe, expect, it } from 'vitest';
import { advanceTraffic, makeRoadPath, makeTrafficCars, sampleRoad, sceneryCarSize, trafficPose } from './sceneryTraffic';
import type { SceneryCar, SceneryRoad } from './sceneryTypes';

const street: SceneryRoad = { id: 'street', points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }], width: 60, closed: false };
const loop: SceneryRoad = { id: 'loop', width: 60, closed: true,
  points: Array.from({ length: 48 }, (_, index) => ({ x: 200 * Math.cos(index / 48 * Math.PI * 2), y: 200 * Math.sin(index / 48 * Math.PI * 2) })) };
const car = (id: string, values: Partial<SceneryCar> = {}): SceneryCar => ({ id, roadId: 'street', lane: 1,
  phase: .2, speed: 80, kind: 'car', variant: 0, ...values });
const carsOn = (road: SceneryRoad, cars: SceneryCar[]) => makeTrafficCars(cars, new Map([[road.id, makeRoadPath(road)]]));
const circularDifference = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

describe('scenery traffic', () => {
  it('drives opposite lanes with opposite headings and separate centres', () => {
    const cars = carsOn(street, [car('out'), car('back', { lane: -1 })]);
    const first = trafficPose(cars[0]), second = trafficPose(cars[1]);
    expect(first.y).toBe(-15);
    expect(second.y).toBe(15);
    expect(Math.abs(circularDifference(first.angle, second.angle))).toBeCloseTo(Math.PI);
    advanceTraffic(cars, .05, true);
    expect(cars[0].distance).toBe(204);
    expect(cars[1].distance).toBe(196);
  });

  it('blends headings through curved vertices and the closed wrap', () => {
    const path = makeRoadPath(loop), at = path.distances[12];
    expect(Math.abs(circularDifference(sampleRoad(path, at - .01).angle, sampleRoad(path, at + .01).angle))).toBeLessThan(.001);
    const before = sampleRoad(path, path.length - .01, 15), after = sampleRoad(path, .01, 15);
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(.03);
    expect(Math.abs(circularDifference(after.angle, before.angle))).toBeLessThan(.001);
    const cars = carsOn(loop, [car('wrap', { roadId: 'loop', phase: .999, speed: 200 })]);
    advanceTraffic(cars, .05, true);
    expect(cars[0].distance).toBeLessThan(10);
    expect(cars[0].moving).toBe(true);
  });

  it('stops before an open road end without turning or teleporting', () => {
    const cars = carsOn(street, [car('out', { phase: .99 }), car('back', { phase: .01, lane: -1 })]);
    const initial = cars.map(entry => entry.distance);
    for (let frame = 0; frame < 60; frame++) advanceTraffic(cars, .05, true);
    expect(cars.map(entry => entry.distance)).toEqual(initial);
    expect(cars.map(entry => entry.moving)).toEqual([false, false]);
    expect(cars[0].distance + cars[0].length / 2).toBe(1000);
    expect(cars[1].distance - cars[1].length / 2).toBe(0);
  });

  it('keeps exact positions while paused and caps a stalled frame', () => {
    const cars = carsOn(street, [car('car')]), initial = cars[0].distance;
    advanceTraffic(cars, 30, false);
    expect(cars[0].distance).toBe(initial);
    advanceTraffic(cars, 30, true);
    expect(cars[0].distance - initial).toBeCloseTo(4);
    advanceTraffic(cars, Number.NaN, true);
    expect(cars[0].distance - initial).toBeCloseTo(4);
    expect(cars[0].moving).toBe(false);
  });

  it.each([1, -1] as const)('never allows a fast follower to pass a slower bus in lane %s', lane => {
    const cars = carsOn(street, [car('follower', { lane, phase: lane === 1 ? .20 : .80, speed: 4000 }),
      car('bus', { lane, phase: lane === 1 ? .27 : .73, speed: 20, kind: 'bus' })]);
    const minimum = (cars[0].length + cars[1].length) / 2 + 7;
    for (let frame = 0; frame < 500; frame++) {
      advanceTraffic(cars, .05, true);
      expect((cars[1].distance - cars[0].distance) * lane).toBeGreaterThanOrEqual(minimum - 1e-8);
    }
  });

  it('protects following space across the loop seam', () => {
    const cars = carsOn(loop, [car('follower', { roadId: 'loop', phase: .97, speed: 500 }),
      car('leader', { roadId: 'loop', phase: .01, speed: 10 })]);
    const length = cars[0].path.length;
    for (let frame = 0; frame < 500; frame++) {
      advanceTraffic(cars, .05, true);
      const gap = (cars[1].distance - cars[0].distance + length) % length;
      expect(gap).toBeGreaterThanOrEqual(36 - 1e-8);
    }
  });

  it('scales vehicles to narrower saved roads and ignores unusably short routes', () => {
    expect(sceneryCarSize(car('car'), 26).width).toBe(6);
    expect(carsOn({ ...street, points: [{ x: 0, y: 0 }, { x: 20, y: 0 }] }, [car('short')])).toEqual([]);
    expect(makeTrafficCars([car('missing')], new Map())).toEqual([]);
  });
});
