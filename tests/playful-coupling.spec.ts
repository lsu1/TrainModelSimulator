import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { makeCouplingDemo } from '../src/couplingDemo';
import { COUPLING_CLOSE_TIME, COUPLING_OPEN_TIME } from '../src/couplingMotion';
import { solveConsistPoses } from '../src/consistPose';
import { solveCoupledFormation } from '../src/formationPose';
import type { TrainSnapshot } from '../src/fleet';
import type { LayoutData } from '../src/layout';
import type { CabEnd, CouplingGroup, CouplingOperation, CouplingTrainType, NoseCouplingState } from '../src/couplingTypes';
import { advanceTrain, attachTrack, endpoints } from '../src/track';
import type { Endpoint, Track, TrainPosition } from '../src/track';
import { getCouplingLinkLength, getTrainCarSpec } from '../src/trains';

// Representative visual journeys complement the CPU matrix of all nine model
// pairs and all four end combinations. Time advances through bounded frames,
// so a screenshot or final pose cannot hide a skipped docking transition.
test.setTimeout(360_000);
const STORAGE_KEY = 'little-railways-layout-v5';
let savedFixtureSequence = 0;
const scene = (page: Page) => page.getByRole('img', { name: '3D railway layout: rotate, zoom, select trains, and move Kato track pieces' });
type Point = { x: number; y: number; z: number };
type Nose = {
  type: CouplingTrainType; end: CabEnd; state: NoseCouplingState;
  pivot: Point; matingFace: Point;
  coverTransforms: { side: string; position: number[]; quaternion: number[]; scale: number[] }[];
};
type Car = {
  index: number; visible: boolean; center: Point; frontBogie: Point; rearBogie: Point;
  frontEnd: Point; rearEnd: Point; noseCoupler?: Nose;
};
type RenderedTrain = TrainSnapshot & {
  running: boolean; actualSpeed: number; stopReason?: string; selected: boolean;
  cars: Car[]; couplers: { index: number; visible: boolean; front: Point; rear: Point }[];
};
type RenderedGroup = CouplingGroup & {
  complete: boolean;
  joint: { head: Point; e6Mount: Point; e5Mount: Point; e6Face: Point; e5Face: Point } | null;
};
const gap = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const flip = (value: 1 | -1): 1 | -1 => value === 1 ? -1 : 1;

async function freeze(page: Page) {
  const time = new Date('2026-01-01T00:00:00Z');
  await page.clock.install({ time });
  await page.clock.pauseAt(time);
}
async function advance(page: Page, milliseconds: number) {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 100) await page.clock.fastForward(Math.min(100, milliseconds - elapsed));
  await page.clock.fastForward(16);
}
async function seed(page: Page, value: LayoutData) {
  await page.addInitScript(({ key, value }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value));
  }, { key: STORAGE_KEY, value });
  await page.goto('/');
  await expect(scene(page)).toHaveAttribute('data-ready', 'true');
  await advance(page, 100);
}
async function replaceSavedLayout(page: Page, value: LayoutData) {
  // Install after the previous document's pagehide autosave has completed.
  // Each replacement gets its own one-shot marker, even when the fixture name
  // and selected train stay the same. Later reloads test real persisted edits.
  await page.addInitScript(({ key, value, marker }) => {
    if (!sessionStorage.getItem(marker)) {
      localStorage.setItem(key, JSON.stringify(value));
      sessionStorage.setItem(marker, 'installed');
    }
  }, { key: STORAGE_KEY, value, marker: `fixture-${++savedFixtureSequence}` });
  await page.reload();
  await expect(scene(page)).toHaveAttribute('data-ready', 'true');
  await advance(page, 100);
}
async function fleet(page: Page): Promise<RenderedTrain[]> {
  return scene(page).evaluate(element => JSON.parse((element as HTMLCanvasElement).dataset.fleetPoses ?? '[]'));
}
async function groups(page: Page): Promise<RenderedGroup[]> {
  return scene(page).evaluate(element => JSON.parse((element as HTMLCanvasElement).dataset.couplingGroups ?? '[]'));
}
async function operation(page: Page): Promise<CouplingOperation | null> {
  return scene(page).evaluate(element => JSON.parse((element as HTMLCanvasElement).dataset.couplingOperation ?? 'null'));
}
async function saved(page: Page): Promise<LayoutData> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY);
}
async function capture(page: Page, info: TestInfo, name: string) {
  await scene(page).scrollIntoViewIfNeeded();
  const path = info.outputPath(`${name}.png`);
  await scene(page).screenshot({ path });
  await info.attach(name, { path, contentType: 'image/png' });
}
function noseAt(train: RenderedTrain, end: CabEnd): Nose {
  const cabIndex = end === 'front' ? 0 : train.carCount - 1;
  const nose = train.cars[cabIndex].noseCoupler;
  expect(nose, `${train.name} ${end} cab has its own movable nose`).toBeTruthy();
  expect(nose!.end).toBe(end);
  return nose!;
}
function expectRigid(train: RenderedTrain) {
  expect(train.cars).toHaveLength(train.carCount);
  expect(train.couplers).toHaveLength(train.carCount - 1);
  for (const car of train.cars) {
    const spec = getTrainCarSpec(train.type, car.index, train.carCount);
    expect(car.visible).toBe(true);
    expect(gap(car.frontEnd, car.rearEnd)).toBeCloseTo(spec.length, 2);
    expect(gap(car.frontBogie, car.rearBogie)).toBeCloseTo(spec.bogieOffset * 2, 2);
  }
  for (const connection of train.couplers) {
    expect(connection.visible).toBe(true);
    expect(gap(connection.front, connection.rear)).toBeCloseTo(getCouplingLinkLength(train.type, connection.index, train.carCount), 2);
  }
}
async function expectLocked(page: Page, expectedEnds?: readonly [CabEnd, CabEnd]) {
  const formation = (await groups(page))[0];
  expect(formation).toBeTruthy();
  expect(formation.complete).toBe(true);
  if (expectedEnds) expect([formation.e6End, formation.e5End]).toEqual(expectedEnds);
  const trains = await fleet(page);
  trains.forEach(expectRigid);
  for (const [id, end] of [[formation.e6Id, formation.e6End ?? 'rear'], [formation.e5Id, formation.e5End ?? 'front']] as const) {
    const train = trains.find(value => value.id === id)!;
    expect(train.stopReason).toBeUndefined();
    const nose = noseAt(train, end);
    expect(nose.state).toMatchObject({ open: 1, extension: 1, locked: true });
    expect(nose.coverTransforms.map(cover => cover.scale)).toEqual([[1, 1, 1], [1, 1, 1]]);
    expect(noseAt(train, end === 'front' ? 'rear' : 'front').state).toMatchObject({ open: 0, extension: 0, locked: false });
  }
  const joint = formation.joint!;
  expect(joint).not.toBeNull();
  expect(gap(joint.e6Mount, joint.head)).toBeCloseTo(3.5, 4);
  expect(gap(joint.e5Mount, joint.head)).toBeCloseTo(3.5, 4);
  expect(gap(joint.e6Mount, joint.e5Mount), 'Compact mounts are only seven model millimetres apart').toBeCloseTo(7, 4);
  expect(gap(joint.e6Face, joint.e5Face), 'Actual rendered mechanical faces touch on the curve').toBeLessThan(.0001);
  expect(gap(joint.e6Face, joint.head)).toBeLessThan(.0001);
  return trains;
}
async function finishOperation(page: Page, expectedGroups: number, maxMilliseconds = 35_000) {
  for (let elapsed = 0; elapsed < maxMilliseconds; elapsed += 500) {
    await advance(page, 500);
    const current = await operation(page);
    expect(current?.paused, 'An accepted operation can finish without becoming trapped').not.toBe(true);
    if (!current) {
      expect(await groups(page)).toHaveLength(expectedGroups);
      return;
    }
  }
  throw new Error(`Operation did not finish: ${JSON.stringify(await operation(page))}`);
}
async function reachPhase(page: Page, phase: CouplingOperation['phase'], maxMilliseconds = 25_000) {
  for (let elapsed = 0; elapsed < maxMilliseconds; elapsed += 300) {
    const current = await operation(page);
    expect(current?.paused).not.toBe(true);
    if (current?.phase === phase) return current;
    await advance(page, 300);
  }
  throw new Error(`Operation never reached ${phase}: ${JSON.stringify(await operation(page))}`);
}

/** Closed oval fixtures retain genuine catalog angles and millimetre lengths. */
function curvedFixture(radius: 315 | 381, leaderType: CouplingTrainType, followerType: CouplingTrainType, end: CabEnd): LayoutData {
  const straightsPerSide = 8;
  const curveCount = radius === 315 ? 4 : 6;
  const curveKind = radius === 315 ? 'c315' : 'c381';
  const tracks: Track[] = [];
  let anchor: Endpoint = { position: { x: -straightsPerSide * 248 / 2, y: -radius, z: 0 }, angle: 0 };
  const half = [...Array<string>(straightsPerSide).fill('s248'), ...Array<string>(curveCount).fill(curveKind)];
  for (const kind of [...half, ...half]) {
    const track = attachTrack(kind, 1, anchor, `curved-coupling-${tracks.length + 1}`);
    tracks.push(track);
    anchor = endpoints(track)[1];
  }
  const curvePosition: TrainPosition = { trackId: tracks[straightsPerSide + 1].id, distance: 90, direction: 1, laps: 0 };
  const leader: TrainSnapshot = {
    id: 'curve-reference', name: `${leaderType.toUpperCase()} curve train 1`, type: leaderType, carCount: 3,
    position: curvePosition, cabForward: true, requestedSpeed: 100,
  };
  if (end === 'rear') {
    const rearOffset = solveConsistPoses(tracks, curvePosition, true, 3, leaderType).rearOffset;
    leader.position = advanceTrain(tracks, curvePosition, rearOffset).position;
  }
  const follower: TrainSnapshot = {
    id: 'curve-partner', name: `${followerType.toUpperCase()} curve train 2`, type: followerType,
    carCount: 3, position: null, cabForward: false, requestedSpeed: 100,
  };
  const formation = solveCoupledFormation(tracks, leader, follower, { e6End: end, e5End: end });
  expect(formation.complete).toBe(true);
  const target = formation.e5Position!;
  const physicalDirection = formation.e5CabForward ? target.direction : flip(target.direction);
  const awayDirection = end === 'front' ? flip(physicalDirection) : physicalDirection;
  const away = advanceTrain(tracks, { ...target, direction: awayDirection }, 45);
  expect(away.stopped).toBe(false);
  follower.position = { ...away.position, direction: awayDirection === physicalDirection ? away.position.direction : flip(away.position.direction) };
  // Snapshot direction represents travel rather than model-forward orientation.
  if (!formation.e5CabForward) follower.position.direction = flip(follower.position.direction);
  follower.cabForward = formation.e5CabForward;
  return {
    version: 5, name: `${leaderType.toUpperCase()} + ${followerType.toUpperCase()} ${end} noses on R${radius}`,
    tracks, accessories: [], trains: [leader, follower], couplings: [], selectedTrainId: leader.id,
    trainType: leaderType, carCount: 3,
  };
}

test('coupling supports mixed models, 11 + 11 cars, seventeen-car formations, and saved stopped resizing', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await freeze(page);
  await seed(page, makeCouplingDemo({ firstType: 'e7', firstCars: 11, secondType: 'e5', secondCars: 11 }));
  const maximum = await fleet(page);
  expect(maximum.map(train => [train.type, train.carCount])).toEqual([['e7', 11], ['e5', 11]]);
  maximum.forEach(expectRigid);
  await expect(page.getByRole('button', { name: 'Couple trains', exact: true })).toBeEnabled();
  await replaceSavedLayout(page, makeCouplingDemo({ firstCars: 7, secondCars: 10 }));
  const authentic = await fleet(page);
  expect(authentic.map(train => [train.type, train.carCount])).toEqual([['e6', 7], ['e5', 10]]);
  authentic.forEach(expectRigid);
  await expect(page.getByRole('button', { name: 'Couple trains', exact: true })).toBeEnabled();

  const layout = await saved(page);
  const [reference, partner] = layout.trains!;
  const descriptor = { id: 'saved-long-formation', e6Id: reference.id, e5Id: partner.id, e6End: 'rear' as const, e5End: 'front' as const };
  const poses = solveCoupledFormation(layout.tracks, reference, partner, descriptor);
  expect(poses.complete).toBe(true);
  layout.version = 5;
  layout.trains = [reference, { ...partner, position: poses.e5Position, cabForward: poses.e5CabForward }];
  layout.couplings = [descriptor];
  layout.selectedTrainId = partner.id;
  await replaceSavedLayout(page, layout);
  expect((await expectLocked(page)).reduce((sum, train) => sum + train.carCount, 0)).toBe(17);
  const count = page.getByRole('combobox', { name: 'Train car count', exact: true });
  await expect(count).toBeEnabled();
  await count.selectOption('4');
  await advance(page, 100);
  await expect(count).toHaveValue('4');
  expect((await expectLocked(page)).map(train => train.carCount)).toEqual([7, 4]);
  await page.getByRole('button', { name: 'Save layout', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Layout name', exact: true }).fill('My longer joined trains');
  await dialog.getByRole('button', { name: 'Save layout', exact: true }).click();
  await advance(page, 100);
  const snapshot = await saved(page);
  expect(snapshot.version).toBe(5);
  expect(snapshot.couplings).toEqual([descriptor]);
  expect(snapshot.trains!.map(train => train.carCount)).toEqual([7, 4]);
  await page.reload();
  await expect(scene(page)).toHaveAttribute('data-ready', 'true');
  await advance(page, 100);
  expect((await expectLocked(page)).every(train => !train.running && train.actualSpeed === 0)).toBe(true);
  expect((await fleet(page)).map(train => train.carCount)).toEqual([7, 4]);
  expect(errors).toEqual([]);
});

test('same-model E7 front noses open slowly, meet compactly on R315, drive together, and close slowly after splitting', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const value = curvedFixture(315, 'e7', 'e7', 'front');
  await freeze(page); await seed(page, value);
  const initial = await fleet(page);
  expect(initial.every(train => train.position && !train.stopReason)).toBe(true);
  await expect(page.getByRole('button', { name: 'Couple trains', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Couple trains', exact: true }).click();
  await advance(page, COUPLING_OPEN_TIME * 400);
  expect((await operation(page))?.phase, 'Covers are still opening after 1.2 seconds').toBe('opening');
  for (const train of await fleet(page)) {
    expect(noseAt(train, 'front').state.open).toBeGreaterThan(0);
    expect(noseAt(train, 'front').state.open).toBeLessThan(1);
    expect(noseAt(train, 'rear').state.open).toBe(0);
    expect(train.position, 'Slow opening leaves the train bodies stationary').toEqual(initial.find(before => before.id === train.id)!.position);
  }
  await capture(page, info, 'e7-e7-partly-open-front-noses-on-r315');
  await advance(page, COUPLING_OPEN_TIME * 700);
  expect((await fleet(page)).every(train => noseAt(train, 'front').state.open === 1)).toBe(true);
  await finishOperation(page, 1);
  const joined = await expectLocked(page, ['front', 'front']);
  expect(joined.every(train => train.selected)).toBe(true);
  await capture(page, info, 'e7-e7-compact-connected-noses-on-r315');
  const slider = page.getByRole('slider', { name: 'Train speed', exact: true });
  await slider.focus(); await slider.press('End');
  await advance(page, 100);
  expect((await fleet(page)).map(train => train.requestedSpeed)).toEqual([275, 275]);
  await page.getByRole('button', { name: 'Run train', exact: true }).click();
  await advance(page, 1500);
  const moving = await expectLocked(page, ['front', 'front']);
  expect(moving.every(train => train.running)).toBe(true);
  expect(moving[0].actualSpeed).toBeCloseTo(moving[1].actualSpeed, 6);
  expect(gap(moving[0].cars[0].center, joined[0].cars[0].center)).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Pause train', exact: true }).click();
  await advance(page, 100);
  const beforeReverse = await fleet(page);
  await page.getByRole('button', { name: 'Reverse train direction', exact: true }).click();
  await advance(page, 100);
  const reversed = await expectLocked(page, ['front', 'front']);
  expect(reversed.map(train => train.cars)).toEqual(beforeReverse.map(train => train.cars));
  expect(reversed.map(train => train.cabForward)).toEqual(beforeReverse.map(train => !train.cabForward));
  await expect(page.getByRole('button', { name: 'Decouple trains', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Decouple trains', exact: true }).click();
  await reachPhase(page, 'closing');
  await advance(page, COUPLING_CLOSE_TIME * 400);
  expect((await operation(page))?.phase, 'Closing takes long enough to watch').toBe('closing');
  for (const train of await fleet(page)) {
    expect(noseAt(train, 'front').state.open).toBeGreaterThan(0);
    expect(noseAt(train, 'front').state.open).toBeLessThan(1);
  }
  await capture(page, info, 'e7-e7-partly-closed-front-noses-after-separation');
  await finishOperation(page, 0);
  for (const train of await fleet(page)) {
    expectRigid(train);
    for (const end of ['front', 'rear'] as const) expect(noseAt(train, end).state).toMatchObject({ open: 0, extension: 0, locked: false });
    expect(train.running).toBe(false);
  }
  expect((await saved(page)).version).toBe(5);
  expect((await saved(page)).couplings).toEqual([]);
  expect(errors).toEqual([]);
});

test('E5 and E7 rear noses automatically connect on R381 and retain the chosen ends in a paused saved formation', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const value = curvedFixture(381, 'e5', 'e7', 'rear');
  await freeze(page); await seed(page, value);
  await expect(page.getByRole('button', { name: 'Couple trains', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Couple trains', exact: true }).click();
  await advance(page, COUPLING_OPEN_TIME * 400);
  for (const train of await fleet(page)) {
    expect(noseAt(train, 'rear').state.open).toBeGreaterThan(0);
    expect(noseAt(train, 'rear').state.open).toBeLessThan(1);
    expect(noseAt(train, 'front').state.open).toBe(0);
  }
  await page.getByRole('button', { name: 'Pause coupling', exact: true }).click();
  await advance(page, 100);
  const paused = await fleet(page);
  await advance(page, 700);
  expect((await fleet(page)).map(train => train.cars)).toEqual(paused.map(train => train.cars));
  await page.getByRole('button', { name: 'Continue coupling', exact: true }).click();
  await finishOperation(page, 1);
  const before = await expectLocked(page, ['rear', 'rear']);
  await capture(page, info, 'e5-e7-rear-noses-connected-on-r381');
  const snapshot = await saved(page);
  expect(snapshot.version).toBe(5);
  expect(snapshot.couplings![0]).toMatchObject({ e6End: 'rear', e5End: 'rear' });
  await page.reload();
  await expect(scene(page)).toHaveAttribute('data-ready', 'true');
  await advance(page, 100);
  const restored = await expectLocked(page, ['rear', 'rear']);
  expect(restored.map(train => train.cars)).toEqual(before.map(train => train.cars));
  expect(restored.every(train => !train.running && train.actualSpeed === 0)).toBe(true);
  await expect(page.getByRole('combobox', { name: 'Train car count', exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
});
