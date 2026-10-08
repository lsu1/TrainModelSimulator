import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { makeKatoPlan02 } from '../src/katoPlan';
import type { TrainSnapshot } from '../src/fleet';
import { getCouplingLinkLength, getTrainCarSpec, getTrainSpec } from '../src/trains';
import type { TrainType } from '../src/trains';

// The CPU suite checks whole circuits. These real app journeys stage the exact
// previously blocked grade to keep software-WebGL regression checks affordable.
test.setTimeout(120_000);
const STORAGE_KEY = 'little-railways-layout-v3';
const scene = (page: Page) => page.getByRole('img', { name: '3D railway layout: rotate, zoom, select trains, and move Kato track pieces' });
type Point = { x: number; y: number; z: number };
type RenderedTrain = TrainSnapshot & {
  running: boolean; status: string; actualSpeed: number; stopReason?: string;
  cars: { index: number; visible: boolean; center: Point; frontEnd: Point; rearEnd: Point; frontBogie: Point; rearBogie: Point }[];
  couplers: { index: number; visible: boolean; front: Point; rear: Point }[];
};
const gap = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function fixture(type: TrainType, carCount: number, state: 'straight' | 'branch', speed: number, distance: number) {
  const original = makeKatoPlan02();
  const tracks = original.tracks.map(track => track.switchNumber ? { ...track, switchState: state } : track);
  const train: TrainSnapshot = {
    id: 'our-train', name: `${getTrainSpec(type).model} on our KATO plan`, type, carCount,
    position: { trackId: 'kato-plan02-main-20', distance, direction: 1, route: 0, laps: 0 },
    cabForward: true, requestedSpeed: speed,
  };
  return {
    ...original, version: 3 as const, tracks, carCount, trainType: type,
    trains: [train], selectedTrainId: train.id,
  };
}

async function freeze(page: Page) {
  const time = new Date('2026-01-01T00:00:00Z');
  await page.clock.install({ time });
  await page.clock.pauseAt(new Date(time.getTime() + 1000));
}

async function advance(page: Page, milliseconds: number) {
  // Fleet physics intentionally caps delayed frames at 100 ms. Keep this test
  // inside that bound rather than skipping directly to the end of a journey.
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 100) {
    await page.clock.fastForward(Math.min(100, milliseconds - elapsed));
  }
  await page.clock.fastForward(16);
}

async function seed(page: Page, layout: object) {
  await page.addInitScript(({ key, layout }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(layout));
  }, { key: STORAGE_KEY, layout });
  await page.goto('/');
  await expect(scene(page)).toHaveAttribute('data-ready', 'true');
  await advance(page, 100);
}

async function train(page: Page): Promise<RenderedTrain> {
  const fleet: RenderedTrain[] = await scene(page).evaluate(element => JSON.parse((element as HTMLCanvasElement).dataset.fleetPoses ?? '[]'));
  expect(fleet).toHaveLength(1);
  return fleet[0];
}

function expectConnectedFormation(value: RenderedTrain) {
  expect(value.position, 'A saved train remains placed on the railway').not.toBeNull();
  expect(value.cars).toHaveLength(value.carCount);
  expect(value.couplers).toHaveLength(value.carCount - 1);
  for (const car of value.cars) {
    const spec = getTrainCarSpec(value.type, car.index, value.carCount);
    expect(car.visible, `Car ${car.index + 1} stays visible through the curve and grade`).toBe(true);
    expect(gap(car.frontEnd, car.rearEnd), 'Car bodies retain their rigid lengths').toBeCloseTo(spec.length, 1);
    expect(gap(car.frontBogie, car.rearBogie), 'Wheelbases retain their rigid chord lengths').toBeCloseTo(spec.bogieOffset * 2, 1);
  }
  for (const coupling of value.couplers) {
    expect(coupling.visible).toBe(true);
    expect(gap(coupling.front, coupling.rear), 'Coupling links remain connected').toBeCloseTo(getCouplingLinkLength(value.type, coupling.index, value.carCount), 1);
  }
}

async function travel(page: Page, milliseconds: number) {
  const visited = new Set<string>();
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 300) {
    await advance(page, 300);
    const value = await train(page);
    expect(value.running, `The train keeps running at ${value.position?.trackId}`).toBe(true);
    expect(value.stopReason, `${value.position?.trackId}: this grade should not produce a curve stop`).toBeUndefined();
    expectConnectedFormation(value);
    visited.add(value.position!.trackId);
  }
  return visited;
}

test('three-car Yamanote resumes its saved KATO grade position and crosses it in both directions', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const layout = fixture('e235', 3, 'straight', 90, 70.197);
  await freeze(page);
  await seed(page, layout);
  const original = await train(page);
  expect(original.position, 'The former blocked position remains safely placed').toEqual(layout.trains[0].position);
  expectConnectedFormation(original);
  await page.reload();
  await expect(scene(page)).toHaveAttribute('data-ready', 'true');
  await advance(page, 100);
  const restored = await train(page);
  expect(restored.position, 'Reload retains the existing design and exact stopped position').toEqual(original.position);
  expect(restored.cars).toEqual(original.cars);
  expect(restored.running).toBe(false);
  await page.getByRole('button', { name: 'Run train', exact: true }).click();
  const forwardVisited = await travel(page, 6000);
  expect(forwardVisited.has('kato-plan02-main-22'), 'The train crosses the former problem curve and its uphill exit').toBe(true);
  expect(forwardVisited.has('kato-plan02-main-23')).toBe(true);
  await page.getByRole('button', { name: 'Pause train', exact: true }).click();
  await advance(page, 100);
  const paused = await train(page);
  await page.getByRole('button', { name: 'Reverse train direction', exact: true }).click();
  await advance(page, 100);
  const reversed = await train(page);
  expect(reversed.position?.direction).toBe(-1);
  expect(reversed.cars, 'Reversal preserves all existing rendered poses').toEqual(paused.cars);
  await page.getByRole('button', { name: 'Run train', exact: true }).click();
  const reverseVisited = await travel(page, 6600);
  expect(reverseVisited.has('kato-plan02-main-20'), 'The return trip crosses the same join downhill').toBe(true);
  expect(reverseVisited.has('kato-plan02-main-19')).toBe(true);
  const screenshot = testInfo.outputPath('three-car-yamanote-kato-grade.png');
  await scene(page).screenshot({ path: screenshot });
  await testInfo.attach('Yamanote-grade-return-trip', { path: screenshot, contentType: 'image/png' });
  expect(errors).toEqual([]);
});

test('eleven-car E5 resumes its saved KATO grade position with the passing route selected', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const layout = fixture('e5', 11, 'branch', 320, 88.197);
  await freeze(page);
  await seed(page, layout);
  const parked = await train(page);
  expect(parked.position, 'The previous stop does not force a new train placement').toEqual(layout.trains[0].position);
  expectConnectedFormation(parked);
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY);
  expect(saved.trains[0].position).toEqual(parked.position);
  expect(saved.trains[0].stopReason, 'Blocked explanations are runtime state, not stored defects').toBeUndefined();
  await page.reload();
  await expect(scene(page)).toHaveAttribute('data-ready', 'true');
  await advance(page, 100);
  const restored = await train(page);
  expect(restored.position, 'Reload preserves the saved train position').toEqual(parked.position);
  expect(restored.cars, 'Reload preserves the parked eleven-car formation').toEqual(parked.cars);
  expect(restored.running).toBe(false);
  expectConnectedFormation(restored);
  await page.getByRole('button', { name: 'Run train', exact: true }).click();
  const visited = await travel(page, 5000);
  expect(visited.has('kato-plan02-main-22'), 'The full formation passes the graded curve').toBe(true);
  expect(visited.has('kato-plan02-main-27'), 'The train continues onto the elevated bridge').toBe(true);
  const resumed = await train(page);
  expect(resumed.running).toBe(true);
  expect(resumed.stopReason).toBeUndefined();
  expectConnectedFormation(resumed);
  expect(gap(resumed.cars[0].center, restored.cars[0].center)).toBeGreaterThan(20);
  const screenshot = testInfo.outputPath('e5-eleven-cars-kato-preset.png');
  await scene(page).screenshot({ path: screenshot });
  await testInfo.attach('full-length-E5-KATO-circuit', { path: screenshot, contentType: 'image/png' });
  expect(errors).toEqual([]);
});
