import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { makeCouplingDemo } from '../src/couplingDemo';
import type { CabEnd, CouplingGroup, CouplingOperation, NoseCouplingState } from '../src/couplingTypes';
import type { TrainSnapshot } from '../src/fleet';
import type { LayoutData } from '../src/layout';
import { advanceTrain } from '../src/track';

// Validate the transforms actually published by the rendered scene, including
// the second physical cab. CPU tests additionally check the continuous path,
// panel geometry and the complete model/end collision matrix.
test.setTimeout(600_000);
const STORAGE_KEY = 'little-railways-layout-v5';
const scene = (page: Page) => page.getByRole('img', {
  name: '3D railway layout: rotate, zoom, select trains, and move Kato track pieces',
});
type Point = { x: number; y: number; z: number };
type Cover = { side: 'left' | 'right'; position: number[]; quaternion: number[]; scale: number[] };
type Nose = {
  type: TrainSnapshot['type']; end: CabEnd; state: NoseCouplingState;
  coverTransforms: Cover[]; matingFace: Point;
};
type Runtime = TrainSnapshot & {
  running: boolean; actualSpeed: number; stopReason?: string;
  cars: { index: number; visible: boolean; center: Point; noseCoupler?: Nose }[];
};
type Formation = CouplingGroup & { complete: boolean };

async function advance(page: Page, milliseconds: number) {
  // Exercise every bounded physical frame, rather than skipping a transition.
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 100) {
    await page.clock.fastForward(Math.min(100, milliseconds - elapsed));
  }
  await page.clock.fastForward(16);
}
async function seed(page: Page, value: LayoutData) {
  const time = new Date('2026-10-12T00:00:00Z');
  await page.clock.install({ time });
  await page.clock.pauseAt(time);
  await page.addInitScript(({ key, value }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value));
  }, { key: STORAGE_KEY, value });
  // Relative navigation also works when verifying the deployed Pages subpath.
  await page.goto('./');
  await expect(scene(page)).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await advance(page, 100);
}
async function fleet(page: Page): Promise<Runtime[]> {
  return scene(page).evaluate(element => JSON.parse((element as HTMLCanvasElement).dataset.fleetPoses ?? '[]'));
}
async function operation(page: Page): Promise<CouplingOperation | null> {
  return scene(page).evaluate(element => JSON.parse((element as HTMLCanvasElement).dataset.couplingOperation ?? 'null'));
}
async function formations(page: Page): Promise<Formation[]> {
  return scene(page).evaluate(element => JSON.parse((element as HTMLCanvasElement).dataset.couplingGroups ?? '[]'));
}
async function saved(page: Page): Promise<LayoutData> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY);
}
function noseAt(train: Runtime, end: CabEnd): Nose {
  const nose = train.cars[end === 'front' ? 0 : train.carCount - 1].noseCoupler;
  expect(nose).toBeTruthy();
  expect(nose!.end).toBe(end);
  return nose!;
}
function activeNoses(trains: Runtime[]) {
  return [noseAt(trains[0], 'rear'), noseAt(trains[1], 'front')];
}
function expectRigidMirroredCovers(nose: Nose, rotated: boolean) {
  expect(nose.coverTransforms).toHaveLength(2);
  const [right, left] = nose.coverTransforms;
  expect([right.side, left.side]).toEqual(['right', 'left']);
  for (const cover of nose.coverTransforms) {
    expect(cover.scale, 'Panel halves keep their dimensions throughout the movement').toEqual([1, 1, 1]);
    expect(Math.hypot(...cover.quaternion), 'Rendered rotations remain unit quaternions').toBeCloseTo(1, 8);
    expect([...cover.position, ...cover.quaternion].every(Number.isFinite)).toBe(true);
  }
  expect(left.position[0]).toBeCloseTo(right.position[0], 8);
  expect(left.position[1]).toBeCloseTo(right.position[1], 8);
  expect(left.position[2]).toBeCloseTo(-right.position[2], 8);
  expect(left.quaternion[0]).toBeCloseTo(0, 8);
  expect(left.quaternion[2]).toBeCloseTo(0, 8);
  expect(left.quaternion[1]).toBeCloseTo(-right.quaternion[1], 8);
  expect(left.quaternion[3]).toBeCloseTo(right.quaternion[3], 8);
  if (rotated) {
    expect(Math.abs(left.quaternion[1]), 'The curved covers turn inward instead of only sliding in sharp stages').toBeGreaterThan(.01);
  }
}
function expectClosed(nose: Nose) {
  expect(nose.state).toMatchObject({ open: 0, extension: 0, locked: false });
  expect(nose.coverTransforms.map(cover => cover.position)).toEqual([[0, 0, 0], [0, 0, 0]]);
  expect(nose.coverTransforms.map(cover => cover.quaternion)).toEqual([[0, 0, 0, 1], [0, 0, 0, 1]]);
  expectRigidMirroredCovers(nose, false);
}
async function capture(page: Page, info: TestInfo, name: string) {
  await scene(page).scrollIntoViewIfNeeded();
  const path = info.outputPath(`${name}.png`);
  await scene(page).screenshot({ path });
  await info.attach(name, { path, contentType: 'image/png' });
  await info.attach(`${name}-rendered-transforms`, {
    body: JSON.stringify({ operation: await operation(page), noses: activeNoses(await fleet(page)) }, null, 2),
    contentType: 'application/json',
  });
  console.info(`Nose cover browser capture: ${name}`);
}
async function reachCoverProgress(page: Page, target: number, opening: boolean) {
  for (let index = 0; index < 35; index++) {
    const noses = activeNoses(await fleet(page));
    const current = await operation(page);
    expect(current?.paused, 'The motion remains accepted by the physical clearance checks').toBe(false);
    const progress = noses[0].state.open;
    expect(noses[1].state.open).toBeCloseTo(progress, 8);
    if (opening ? progress >= target : progress <= target) return noses;
    await advance(page, 80);
  }
  throw new Error(`The covers did not reach ${target}: ${JSON.stringify(await operation(page))}`);
}
async function finish(page: Page, expectedCount: number) {
  for (let elapsed = 0; elapsed < 40_000; elapsed += 400) {
    const current = await operation(page);
    expect(current?.paused).not.toBe(true);
    if (!current) {
      expect(await formations(page)).toHaveLength(expectedCount);
      return;
    }
    await advance(page, 400);
  }
  throw new Error(`Operation did not finish: ${JSON.stringify(await operation(page))}`);
}
async function reachClosing(page: Page) {
  for (let elapsed = 0; elapsed < 30_000; elapsed += 300) {
    const current = await operation(page);
    expect(current?.paused).not.toBe(true);
    if (current?.phase === 'closing') return;
    await advance(page, 300);
  }
  throw new Error(`Closing did not start: ${JSON.stringify(await operation(page))}`);
}

for (const type of ['e5', 'e6', 'e7'] as const) {
  const journey = type === 'e5' ? 'join, reload and close smoothly' : 'restore closed after an interrupted reload';
  test(`${type.toUpperCase()} curved cover halves open, pause and ${journey}`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const fixture = makeCouplingDemo({ firstType: type, secondType: type });
    // Keep the original closed railway and models, with a 35 mm initial gap so
    // software rendering checks the mechanism without a long empty approach.
    fixture.trains![1].position = advanceTrain(fixture.tracks, fixture.trains![1].position!, 45).position;
    await seed(page, fixture);
    const initial = await fleet(page);
    initial.forEach(train => {
      expect(train.cars.every(car => car.visible)).toBe(true);
      expectClosed(noseAt(train, 'front'));
      expectClosed(noseAt(train, 'rear'));
    });
    await expect(page.getByText('Start a new layout', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Start coupling practice', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Couple trains', exact: true }).click();
    // Pause before advancing time to inspect the original closed silhouette in
    // the actual Nose view, without modifying the fixture or the application.
    await page.getByRole('button', { name: 'Pause coupling', exact: true }).click();
    await advance(page, 16);
    expect((await operation(page))?.paused).toBe(true);
    activeNoses(await fleet(page)).forEach(expectClosed);
    const camera = await scene(page).evaluate(element => JSON.parse((element as HTMLCanvasElement).dataset.cameraPose!));
    expect(camera.preset).toBe('coupling');
    expect(camera.couplingFocus).not.toBeNull();
    await capture(page, info, `${type}-closed`);
    await page.getByRole('button', { name: 'Continue coupling', exact: true }).click();
    await advance(page, 16);
    for (const target of [.25, .5, .75, 1]) {
      const noses = await reachCoverProgress(page, target, true);
      noses.forEach(nose => expectRigidMirroredCovers(nose, target >= .5 && target < 1));
      const values = await fleet(page);
      expect(values.map(train => train.position), 'Cover movement does not move either train body').toEqual(initial.map(train => train.position));
      expectClosed(noseAt(values[0], 'front'));
      expectClosed(noseAt(values[1], 'rear'));
      await capture(page, info, `${type}-opening-${Math.round(target * 100)}`);
      if (target === .5) {
        await page.getByRole('button', { name: 'Pause coupling', exact: true }).click();
        await advance(page, 16);
        const paused = await fleet(page);
        await advance(page, 600);
        expect((await fleet(page)).map(train => train.cars)).toEqual(paused.map(train => train.cars));
        await page.getByRole('button', { name: 'Continue coupling', exact: true }).click();
        await advance(page, 16);
      }
    }
    // One complete physical journey below checks integration and closing.
    // The other shells share that effect; inspect their actual painted panels
    // and interruption recovery without repeating the unchanged long travel.
    if (type !== 'e5') {
      expect((await operation(page))?.phase).toBe('opening');
      await page.reload();
      await expect(scene(page)).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
      await advance(page, 100);
      const restored = await fleet(page);
      expect(restored.map(train => train.cars)).toEqual(initial.map(train => train.cars));
      expect(restored.every(train => !train.running && train.actualSpeed === 0)).toBe(true);
      expect(await operation(page)).toBeNull();
      expect(await formations(page)).toEqual([]);
      expect((await saved(page)).version).toBe(5);
      expect((await saved(page)).couplings).toEqual([]);
      await capture(page, info, `${type}-closed-after-interrupted-reload`);
      expect(errors).toEqual([]);
      return;
    }
    await finish(page, 1);
    console.info(`Nose cover browser journey: ${type} joined`);
    const joined = await fleet(page);
    expect((await formations(page))[0].complete).toBe(true);
    activeNoses(joined).forEach(nose => {
      expect(nose.state).toMatchObject({ open: 1, extension: 1, locked: true });
      expectRigidMirroredCovers(nose, false);
    });
    const [first, second] = activeNoses(joined);
    expect(Math.hypot(first.matingFace.x - second.matingFace.x, first.matingFace.y - second.matingFace.y,
      first.matingFace.z - second.matingFace.z), 'The completed joint still uses coincident mechanical faces').toBeLessThan(.0001);
    const snapshot = await saved(page);
    expect(snapshot.version).toBe(5);
    expect(snapshot.couplings).toHaveLength(1);
    await page.reload();
    await expect(scene(page)).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
    await advance(page, 100);
    const restored = await fleet(page);
    expect(restored.map(train => train.cars)).toEqual(joined.map(train => train.cars));
    expect(restored.every(train => !train.running && train.actualSpeed === 0)).toBe(true);
    console.info(`Nose cover browser journey: ${type} restored the stopped joined formation`);
    await page.getByRole('button', { name: 'Nose view', exact: true }).click();
    await advance(page, 16);
    await page.getByRole('button', { name: 'Decouple trains', exact: true }).click();
    await reachClosing(page);
    console.info(`Nose cover browser journey: ${type} separation reached closing`);
    for (const target of [.75, .5, .25]) {
      const noses = await reachCoverProgress(page, target, false);
      noses.forEach(nose => expectRigidMirroredCovers(nose, target >= .5));
      await capture(page, info, `${type}-closing-${Math.round(target * 100)}`);
    }
    await finish(page, 0);
    const independent = await fleet(page);
    independent.forEach(train => {
      expectClosed(noseAt(train, 'front'));
      expectClosed(noseAt(train, 'rear'));
      expect(train.stopReason).toBeUndefined();
      expect(train.running).toBe(false);
    });
    expect((await saved(page)).couplings).toEqual([]);
    await capture(page, info, `${type}-closed-after-separation`);
    expect(errors).toEqual([]);
  });
}
