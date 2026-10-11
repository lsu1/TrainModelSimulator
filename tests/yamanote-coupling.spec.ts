import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { solveConsistPoses } from '../src/consistPose';
import type { CabEnd, CouplingGroup, CouplingOperation, NoseCouplingState } from '../src/couplingTypes';
import type { TrainSnapshot } from '../src/fleet';
import { solveCoupledFormation } from '../src/formationPose';
import type { LayoutData } from '../src/layout';
import { advanceTrain, attachTrack, endpoints } from '../src/track';
import type { Endpoint, Track, TrainPosition } from '../src/track';
import { getCouplingLinkLength, getTrainCarSpec } from '../src/trains';

// One short, straight docking journey checks actual rendered exposed heads,
// shared controls and persistence. The full end/orientation matrix runs on CPU.
test.setTimeout(360_000);
const STORAGE_KEY = 'little-railways-layout-v5';
const SAVED_DESIGNS_KEY = 'little-railways-saved-designs-v1';
const scene = (page: Page) => page.getByRole('img', {
  name: '3D railway layout: rotate, zoom, select trains, and move Kato track pieces',
});
const speed = (page: Page) => page.getByRole('slider', { name: 'Train speed', exact: true });
const trainCard = (page: Page, id: string) => page.getByRole('group', {
  name: 'Select a train to drive', exact: true,
}).locator(`button[data-train-id="${id}"]`);

type Point = { x: number; y: number; z: number };
type Nose = {
  type: TrainSnapshot['type']; mechanism: 'exposed' | 'covered'; end: CabEnd;
  state: NoseCouplingState; pivot: Point; matingFace: Point; coverTransforms: unknown[];
};
type Car = {
  index: number; visible: boolean; center: Point; frontEnd: Point; rearEnd: Point;
  quaternion: number[]; noseCoupler?: Nose;
};
type Runtime = TrainSnapshot & {
  running: boolean; actualSpeed: number; stopReason?: string;
  cars: Car[]; couplers: { visible: boolean; front: Point; rear: Point }[];
};
type RenderedGroup = CouplingGroup & { complete: boolean };
const gap = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function fixture(): LayoutData {
  const tracks: Track[] = [];
  let anchor: Endpoint = { position: { x: -1488, y: 0, z: 0 }, angle: 0 };
  for (let index = 0; index < 12; index++) {
    const piece = attachTrack('s248', 1, anchor, `emergency-line-${index}`);
    tracks.push(piece);
    anchor = endpoints(piece)[1];
  }
  const start: TrainPosition = { trackId: tracks[0].id, distance: 0, direction: 1, route: 0, laps: 0 };
  const cursor = (distance: number) => advanceTrain(tracks, start, distance).position;
  const first: TrainSnapshot = {
    id: 'yamanote-first', name: 'Yamanote first', type: 'e235', carCount: 3,
    position: cursor(1280), cabForward: true, requestedSpeed: 20,
  };
  const second: TrainSnapshot = {
    id: 'yamanote-second', name: 'Yamanote second', type: 'e235', carCount: 3,
    position: { ...cursor(1300), direction: -1 }, cabForward: true, requestedSpeed: 20,
  };
  const incompatible: TrainSnapshot = {
    id: 'parked-shinkansen', name: 'Parked E5', type: 'e5', carCount: 3,
    position: cursor(2530), cabForward: true, requestedSpeed: 65,
  };
  const firstPoses = solveConsistPoses(tracks, first.position!, true, 3, 'e235');
  const secondPoses = solveConsistPoses(tracks, second.position!, true, 3, 'e235');
  expect(firstPoses.cars.every(Boolean)).toBe(true);
  expect(secondPoses.cars.every(Boolean)).toBe(true);
  expect(gap(firstPoses.cars[0]!.frontEnd, secondPoses.cars[0]!.frontEnd)).toBeCloseTo(20, 5);
  const settled = solveCoupledFormation(tracks, first, second, { e6End: 'front', e5End: 'front' });
  expect(settled.complete).toBe(true);
  expect(settled.e5CabForward).toBe(false);
  return {
    version: 5, name: 'Existing emergency-inspired Yamanote formation', tracks, accessories: [],
    trains: [first, second, incompatible], couplings: [], selectedTrainId: first.id,
    trainType: 'e235', carCount: 3,
  };
}

async function advance(page: Page, milliseconds: number) {
  // The simulator caps delayed frames at 100 ms. Preserve the physical path.
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 100) {
    await page.clock.fastForward(Math.min(100, milliseconds - elapsed));
  }
  await page.clock.fastForward(16);
}

async function seed(page: Page, value: LayoutData) {
  const time = new Date('2026-10-11T00:00:00Z');
  await page.clock.install({ time });
  await page.clock.pauseAt(time);
  await page.addInitScript(({ key, value }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value));
  }, { key: STORAGE_KEY, value });
  await page.goto('./');
  await expect(scene(page)).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await advance(page, 100);
}

async function fleet(page: Page): Promise<Runtime[]> {
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
function yamanote(trains: Runtime[]) {
  return trains.filter(train => train.type === 'e235');
}
function frontNose(train: Runtime): Nose {
  const nose = train.cars[0].noseCoupler;
  expect(nose).toBeTruthy();
  expect(nose!.end).toBe('front');
  return nose!;
}
function expectExposed(trains: Runtime[]) {
  for (const train of yamanote(trains)) {
    expect(train.cars.every(car => car.visible)).toBe(true);
    for (const index of [0, train.carCount - 1]) {
      const nose = train.cars[index].noseCoupler!;
      expect(nose, 'Both E235 cab heads remain available').toBeTruthy();
      expect(nose.mechanism).toBe('exposed');
      expect(nose.coverTransforms).toEqual([]);
      expect(nose.state).toMatchObject({ open: 0, extension: 1 });
      expect(gap(nose.pivot, nose.matingFace)).toBeCloseTo(3.5, 4);
    }
    for (const car of train.cars) {
      expect(gap(car.frontEnd, car.rearEnd)).toBeCloseTo(getTrainCarSpec(train.type, car.index, train.carCount).length, 3);
    }
    for (const [index, coupling] of train.couplers.entries()) {
      expect(coupling.visible).toBe(true);
      expect(gap(coupling.front, coupling.rear)).toBeCloseTo(getCouplingLinkLength(train.type, index, train.carCount), 3);
    }
  }
}
async function expectLocked(page: Page) {
  const formations = await groups(page);
  expect(formations).toHaveLength(1);
  expect(formations[0]).toMatchObject({
    e6End: 'front', e5End: 'front', complete: true,
  });
  expect([formations[0].e6Id, formations[0].e5Id].sort()).toEqual(['yamanote-first', 'yamanote-second']);
  const trains = await fleet(page);
  expectExposed(trains);
  const [first, second] = yamanote(trains);
  expect(frontNose(first).state.locked).toBe(true);
  expect(frontNose(second).state.locked).toBe(true);
  expect(first.cars.at(-1)!.noseCoupler!.state.locked).toBe(false);
  expect(second.cars.at(-1)!.noseCoupler!.state.locked).toBe(false);
  expect(gap(frontNose(first).matingFace, frontNose(second).matingFace), 'The actual rendered E235 mating faces touch').toBeLessThan(.0001);
  expect(gap(first.cars[0].frontEnd, second.cars[0].frontEnd)).toBeCloseTo(5, 4);
  expect(gap(frontNose(first).pivot, frontNose(second).pivot)).toBeCloseTo(7, 4);
  expect(first.stopReason).toBeUndefined();
  expect(second.stopReason).toBeUndefined();
  return trains;
}
function poses(trains: Runtime[]) {
  return yamanote(trains).map(train => train.cars.map(car => ({ center: car.center, quaternion: car.quaternion })));
}

test('front-facing Yamanote cabs join through exposed heads, share controls, save and separate', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 720 });
  const source = fixture();
  await seed(page, source);
  const initial = await fleet(page);
  expectExposed(initial);
  const parked = initial.find(train => train.id === 'parked-shinkansen')!;
  const partner = page.getByRole('combobox', { name: 'Coupling partner', exact: true });
  await expect(partner).toHaveValue('yamanote-second');
  await expect(partner.locator('option')).toHaveCount(1);
  await expect(partner.locator('option[value="parked-shinkansen"]')).toHaveCount(0);
  await expect(page.getByText('Real Yamanote trains join only in emergencies.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Couple trains', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Couple trains', exact: true }).click();
  await advance(page, 300);
  expect((await operation(page))?.phase).toBe('approaching');
  await expect(page.getByRole('button', { name: 'Coupler view', exact: true })).toBeEnabled();
  expectExposed(await fleet(page));

  await page.getByRole('button', { name: 'Pause coupling', exact: true }).click();
  await advance(page, 100);
  const paused = await operation(page);
  const heldPoses = poses(await fleet(page));
  expect(paused?.paused).toBe(true);
  await expect(speed(page)).toBeDisabled();
  await advance(page, 500);
  expect(await operation(page)).toEqual(paused);
  expect(poses(await fleet(page))).toEqual(heldPoses);
  await trainCard(page, 'parked-shinkansen').click();
  await advance(page, 100);
  await expect(page.getByRole('region', { name: 'Cab coupling', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Coupler view', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Nose view', exact: true })).toHaveCount(0);
  await trainCard(page, 'yamanote-first').click();
  await advance(page, 100);
  await page.getByRole('button', { name: 'Continue coupling', exact: true }).click();
  await advance(page, 100);

  const phases = new Set<CouplingOperation['phase']>();
  for (let elapsed = 0; elapsed < 6000; elapsed += 100) {
    const current = await operation(page);
    expect(current?.paused).not.toBe(true);
    if (current) phases.add(current.phase);
    expectExposed(await fleet(page));
    if (current?.phase === 'locking') break;
    await advance(page, 100);
  }
  expect((await operation(page))?.phase).toBe('locking');
  const docking = yamanote(await fleet(page));
  expect(gap(frontNose(docking[0]).matingFace, frontNose(docking[1]).matingFace)).toBeLessThan(.0001);
  await page.getByRole('button', { name: 'Pause coupling', exact: true }).click();
  await advance(page, 100);
  expect((await operation(page))?.paused).toBe(true);
  await page.getByRole('button', { name: 'Continue coupling', exact: true }).click();
  await advance(page, 700);
  expect(await operation(page)).toBeNull();
  const joined = await expectLocked(page);
  const referenceId = (await groups(page))[0].e6Id;
  const travelSign = joined.find(train => train.id === referenceId)!.position!.direction;
  await expect(page.getByRole('region', { name: 'Cab coupling', exact: true })).toContainText('6 cars');
  await page.screenshot({ path: info.outputPath('yamanote-front-to-front-coupler-view.png') });

  await expect(speed(page)).toHaveAttribute('max', '90');
  await speed(page).press('End');
  await advance(page, 100);
  expect(yamanote(await fleet(page)).map(train => train.requestedSpeed)).toEqual([90, 90]);
  await page.getByRole('button', { name: 'Run train', exact: true }).click();
  await advance(page, 500);
  const moving = await expectLocked(page);
  for (const [index, train] of yamanote(moving).entries()) {
    expect(train.running).toBe(true);
    expect(train.actualSpeed).toBeGreaterThan(0);
    expect((train.cars[0].center.x - yamanote(joined)[index].cars[0].center.x) * travelSign).toBeGreaterThan(1);
  }
  expect(yamanote(moving)[0].actualSpeed).toBe(yamanote(moving)[1].actualSpeed);
  await page.getByRole('button', { name: 'Pause train', exact: true }).click();
  await advance(page, 100);
  await trainCard(page, 'yamanote-second').click();
  await advance(page, 100);
  const beforeReverse = await expectLocked(page);
  await page.getByRole('button', { name: 'Reverse train direction', exact: true }).click();
  await advance(page, 100);
  expect(poses(await expectLocked(page)), 'Reversal preserves both physical cabs and all car indices').toEqual(poses(beforeReverse));
  await page.getByRole('button', { name: 'Run train', exact: true }).click();
  await advance(page, 500);
  const reversed = await expectLocked(page);
  for (const [index, train] of yamanote(reversed).entries()) {
    expect((train.cars[0].center.x - yamanote(beforeReverse)[index].cars[0].center.x) * travelSign).toBeLessThan(-1);
  }
  await page.getByRole('button', { name: 'Pause train', exact: true }).click();
  await advance(page, 100);

  await page.getByRole('button', { name: 'Save layout', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save your railway', exact: true });
  await dialog.getByRole('textbox', { name: 'Layout name', exact: true }).fill('Emergency-inspired Yamanote pair');
  await dialog.getByRole('button', { name: 'Save layout', exact: true }).click();
  await advance(page, 100);
  const snapshot = await saved(page);
  expect(snapshot.couplings).toHaveLength(1);
  expect(snapshot.couplings![0]).toMatchObject({ e6End: 'front', e5End: 'front' });
  const library = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), SAVED_DESIGNS_KEY);
  expect(library.designs.find((design: { name: string }) => design.name === 'Emergency-inspired Yamanote pair').layout.couplings).toEqual(snapshot.couplings);
  await page.reload();
  await expect(scene(page)).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await advance(page, 100);
  const restored = await expectLocked(page);
  expect(restored.map(train => ({ id: train.id, position: train.position, cabForward: train.cabForward, requestedSpeed: train.requestedSpeed }))).toEqual(
    snapshot.trains!.map(train => ({ id: train.id, position: train.position, cabForward: train.cabForward, requestedSpeed: train.requestedSpeed })),
  );
  expect(restored.every(train => !train.running && train.actualSpeed === 0)).toBe(true);

  await expect(page.getByRole('button', { name: 'Decouple trains', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Decouple trains', exact: true }).click();
  await advance(page, 100);
  for (let elapsed = 0; elapsed < 14_000; elapsed += 500) {
    const current = await operation(page);
    if (!current) break;
    phases.add(current.phase);
    expect(current.paused).toBe(false);
    expectExposed(await fleet(page));
    await advance(page, 500);
  }
  expect(await operation(page)).toBeNull();
  expect(await groups(page)).toHaveLength(0);
  expect(phases.has('approaching')).toBe(true);
  expect(phases.has('locking')).toBe(true);
  expect(phases.has('unlocking')).toBe(true);
  expect(phases.has('separating')).toBe(true);
  expect(phases.has('opening')).toBe(false);
  expect(phases.has('closing')).toBe(false);
  const separated = await fleet(page);
  expectExposed(separated);
  const pair = yamanote(separated);
  expect(pair.every(train => !train.running && !frontNose(train).state.locked)).toBe(true);
  expect(gap(frontNose(pair[0]).matingFace, frontNose(pair[1]).matingFace)).toBeCloseTo(55, 3);
  expect(separated.find(train => train.id === 'parked-shinkansen')!.cars).toEqual(parked.cars);
  await page.screenshot({ path: info.outputPath('yamanote-separated-exposed-cabs.png') });

  await page.getByRole('button', { name: 'Run train', exact: true }).click();
  await advance(page, 300);
  const independent = yamanote(await fleet(page));
  expect(independent[0].running).toBe(false);
  expect(independent[0].cars).toEqual(pair[0].cars);
  expect(independent[1].running).toBe(true);
  await page.getByRole('button', { name: 'Pause train', exact: true }).click();
  const assets = await page.locator('script[src], link[rel="stylesheet"]').evaluateAll(elements => elements.map(element =>
    element.tagName === 'SCRIPT' ? (element as HTMLScriptElement).src : (element as HTMLLinkElement).href));
  await info.attach('loaded-assets', {
    body: JSON.stringify({ pageUrl: page.url(), assets, errors }, null, 2), contentType: 'application/json',
  });
  expect(errors).toEqual([]);
});
