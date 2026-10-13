import type { SceneryCar, SceneryPoint, SceneryRoad } from './sceneryTypes';

export interface RoadPath {
  road: SceneryRoad;
  points: SceneryPoint[];
  distances: number[];
  tangents: SceneryPoint[];
  length: number;
}

const unit = (x: number, y: number): SceneryPoint => {
  const length = Math.hypot(x, y);
  return length > 1e-8 ? { x: x / length, y: y / length } : { x: 1, y: 0 };
};
const modulo = (value: number, length: number) => ((value % length) + length) % length;

/** Keep the generator's exact, clearance-checked route; blend headings at its sampled corners. */
export function makeRoadPath(road: SceneryRoad): RoadPath {
  const points = road.points.filter((point, index) => index === 0 ||
    Math.hypot(point.x - road.points[index - 1].x, point.y - road.points[index - 1].y) > 1e-6)
    .map(point => ({ ...point }));
  if (road.closed && points.length > 1 && Math.hypot(points[0].x - points.at(-1)!.x, points[0].y - points.at(-1)!.y) < 1e-6) points.pop();
  const count = points.length;
  const tangents = points.map((point, index) => {
    const before = points[index ? index - 1 : road.closed ? count - 1 : 0];
    const after = points[index < count - 1 ? index + 1 : road.closed ? 0 : count - 1];
    const entering = unit(point.x - before.x, point.y - before.y);
    const leaving = unit(after.x - point.x, after.y - point.y);
    if (!road.closed && index === 0) return leaving;
    if (!road.closed && index === count - 1) return entering;
    return unit(entering.x + leaving.x, entering.y + leaving.y);
  });
  const distances = [0];
  for (let index = 1; index < count; index++) {
    distances.push(distances.at(-1)! + Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y));
  }
  if (road.closed && count > 1) distances.push(distances.at(-1)! + Math.hypot(points[0].x - points[count - 1].x, points[0].y - points[count - 1].y));
  return { road, points, distances, tangents, length: distances.at(-1) ?? 0 };
}

export function sampleRoad(path: RoadPath, distance: number, offset = 0) {
  const value = path.length > 0 ? path.road.closed ? modulo(distance, path.length) : Math.max(0, Math.min(path.length, distance)) : 0;
  let segment = 0;
  while (segment < path.distances.length - 2 && path.distances[segment + 1] <= value) segment++;
  const a = path.points[segment] ?? { x: 0, y: 0 }, next = (segment + 1) % Math.max(1, path.points.length);
  const b = path.points[next] ?? a;
  const start = path.distances[segment] ?? 0, end = path.distances[segment + 1] ?? start;
  const fraction = end > start ? (value - start) / (end - start) : 0;
  const ta = path.tangents[segment] ?? { x: 1, y: 0 }, tb = path.tangents[next] ?? ta;
  const tangent = unit(ta.x + (tb.x - ta.x) * fraction, ta.y + (tb.y - ta.y) * fraction);
  return {
    x: a.x + (b.x - a.x) * fraction - tangent.y * offset,
    y: a.y + (b.y - a.y) * fraction + tangent.x * offset,
    angle: Math.atan2(tangent.y, tangent.x),
  };
}

export function sceneryCarSize(car: SceneryCar, roadWidth = 60) {
  const scale = Math.min(1, roadWidth / 52);
  const dimensions = car.kind === 'bus' ? { length: 60, width: 16, height: 20 } :
    car.kind === 'van' ? { length: 32, width: 13, height: 14 } : { length: 29, width: 12, height: 10 };
  return { length: dimensions.length * scale, width: dimensions.width * scale, height: dimensions.height * scale };
}

export interface TrafficCar {
  car: SceneryCar;
  path: RoadPath;
  distance: number;
  length: number;
  moving: boolean;
}

export function makeTrafficCars(cars: readonly SceneryCar[], paths: ReadonlyMap<string, RoadPath>): TrafficCar[] {
  return cars.flatMap(car => {
    const path = paths.get(car.roadId);
    if (!path || path.length < 1) return [];
    const length = sceneryCarSize(car, path.road.width).length;
    if (path.length < length + 14) return [];
    const initial = Math.max(0, Math.min(1, car.phase)) * path.length;
    return [{ car, path, distance: path.road.closed ? modulo(initial, path.length) : Math.max(length / 2, Math.min(path.length - length / 2, initial)), length, moving: false }];
  });
}

/** Simultaneous conservative following: nobody can enter their leader's current safety space. */
export function advanceTraffic(cars: TrafficCar[], deltaSeconds: number, playing: boolean) {
  const delta = playing && Number.isFinite(deltaSeconds) ? Math.max(0, Math.min(.05, deltaSeconds)) : 0;
  const movements = cars.map(follower => {
    if (!delta) return 0;
    const direction = follower.car.lane;
    let movement = Math.max(0, follower.car.speed) * delta;
    if (!follower.path.road.closed) {
      const endSpace = direction === 1 ? follower.path.length - follower.length / 2 - follower.distance : follower.distance - follower.length / 2;
      movement = Math.min(movement, Math.max(0, endSpace));
    }
    for (const leader of cars) {
      if (leader === follower || leader.car.roadId !== follower.car.roadId || leader.car.lane !== direction) continue;
      let gap = (leader.distance - follower.distance) * direction;
      if (follower.path.road.closed) gap = modulo(gap, follower.path.length);
      if (gap < 0) continue;
      movement = Math.min(movement, Math.max(0, gap - (follower.length + leader.length) / 2 - 7));
    }
    return movement;
  });
  cars.forEach((entry, index) => {
    const movement = movements[index];
    entry.distance += movement * entry.car.lane;
    if (entry.path.road.closed) entry.distance = modulo(entry.distance, entry.path.length);
    entry.moving = movement > 1e-7;
  });
}

export function trafficPose(entry: TrafficCar) {
  // In the X/Z ground plane, physical left is negative Z for a vehicle heading +X.
  const point = sampleRoad(entry.path, entry.distance, -entry.car.lane * entry.path.road.width / 4);
  return { x: point.x, y: point.y, angle: point.angle + (entry.car.lane === -1 ? Math.PI : 0) };
}
