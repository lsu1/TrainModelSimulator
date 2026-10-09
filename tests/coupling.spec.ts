import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { makeCouplingDemo } from '../src/couplingDemo';
import { solveCoupledFormation } from '../src/formationPose';
import { getCouplingLinkLength, getTrainCarSpec } from '../src/trains';
import type { TrainSnapshot } from '../src/fleet';
import type { CouplingGroup, CouplingOperation, NoseCouplingState } from '../src/couplingTypes';
import { NOSE_COUPLER_PROFILES } from '../src/couplingTypes';

// The real rendered anchors are checked here; the CPU suite covers full laps,
// body contact, turnouts, grades, interruption, and high-speed collision sweeps.
// Software WebGL renders every bounded approach/separation frame. The long
// journey's timeout accommodates that QA cost without skipping transitions.
test.setTimeout(600_000);
const STORAGE_KEY = 'little-railways-layout-v5';
const scene = (page: Page) => page.getByRole('img', { name: '3D railway layout: rotate, zoom, select trains, and move Kato track pieces' });
const driving = (page: Page) => page.getByRole('combobox', { name: 'Train to drive', exact: true });
type Point = { x: number; y: number; z: number };
type Nose = {
  type: 'e5' | 'e6' | 'e7'; end: 'front' | 'rear'; state: NoseCouplingState; pivot: Point; matingFace: Point;
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
type CameraPose = { preset: string; eye: Point; target: Point; couplingFocus: Point | null };
const gap = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

async function freeze(page: Page) {
  const time = new Date('2026-01-01T00:00:00Z');
  await page.clock.install({ time });
  await page.clock.pauseAt(time);
}

async function advance(page: Page, milliseconds: number) {
  // The application's delayed-frame bound is 100 ms. Exercise every bounded
  // state transition instead of jumping across the approach or separation.
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 100) await page.clock.fastForward(Math.min(100, milliseconds - elapsed));
  await page.clock.fastForward(16);
}

async function seed(page: Page, value: object) {
  await page.addInitScript(({ key, value }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value));
  }, { key: STORAGE_KEY, value });
  await page.goto('/');
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

async function cameraPose(page: Page): Promise<CameraPose> {
  return scene(page).evaluate(element => JSON.parse((element as HTMLCanvasElement).dataset.cameraPose!));
}

async function expectNoseView(page: Page) {
  const camera = await cameraPose(page);
  expect(camera.preset).toBe('coupling');
  expect(camera.couplingFocus).not.toBeNull();
  expect(gap(camera.target, camera.couplingFocus!)).toBeLessThan(.0001);
  const values = await fleet(page);
  const a = noseOf(values.find(train => train.type === 'e6')!).matingFace;
  const b = noseOf(values.find(train => train.type === 'e5')!).matingFace;
  expect(gap(camera.couplingFocus!, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 })).toBeLessThan(.0001);
  return camera;
}

async function saved(page: Page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY);
}

async function capture(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await scene(page).screenshot({ path });
  await info.attach(name, { path, contentType: 'image/png' });
}

function noseOf(value: RenderedTrain): Nose {
  const noses = value.cars.filter(car => car.noseCoupler);
  expect(noses, 'Either physical Shinkansen cab can open for playful coupling').toHaveLength(2);
  expect(noses.map(car => car.index)).toEqual([0, value.carCount - 1]);
  const active = noses.find(car => car.noseCoupler!.state.open > 0 || car.noseCoupler!.state.extension > 0 || car.noseCoupler!.state.locked);
  return (active ?? noses.find(car => car.index === (value.type === 'e6' ? value.carCount - 1 : 0)))!.noseCoupler!;
}

function expectRigid(value: RenderedTrain) {
  expect(value.cars).toHaveLength(value.carCount);
  expect(value.couplers).toHaveLength(value.carCount - 1);
  for (const car of value.cars) {
    const spec = getTrainCarSpec(value.type, car.index, value.carCount);
    expect(car.visible, `${value.name}: car ${car.index + 1} stays on the railway`).toBe(true);
    expect(gap(car.frontEnd, car.rearEnd)).toBeCloseTo(spec.length, 2);
    expect(gap(car.frontBogie, car.rearBogie)).toBeCloseTo(spec.bogieOffset * 2, 2);
  }
  for (const connection of value.couplers) {
    expect(connection.visible).toBe(true);
    expect(gap(connection.front, connection.rear)).toBeCloseTo(getCouplingLinkLength(value.type, connection.index, value.carCount), 2);
  }
}

async function expectLocked(page: Page) {
  const values = await fleet(page);
  expect(values).toHaveLength(2);
  values.forEach(expectRigid);
  for (const value of values) {
    const nose = noseOf(value);
    expect(nose.state.open).toBe(1);
    expect(nose.state.extension).toBe(1);
    expect(nose.state.locked).toBe(true);
    expect(nose.coverTransforms.map(cover => cover.scale)).toEqual([[1, 1, 1], [1, 1, 1]]);
    expect(value.stopReason).toBeUndefined();
  }
  const joined = await groups(page);
  expect(joined).toHaveLength(1);
  expect(joined[0].complete).toBe(true);
  const joint = joined[0].joint!;
  expect(joint).not.toBeNull();
  expect(gap(joint.e6Mount, joint.head), 'The E6 shank remains compact').toBeCloseTo(NOSE_COUPLER_PROFILES.e6.extensionLength, 4);
  expect(gap(joint.e5Mount, joint.head), 'The E5 shank remains compact').toBeCloseTo(NOSE_COUPLER_PROFILES.e5.extensionLength, 4);
  expect(gap(joint.e6Mount, joint.e5Mount), 'The two mounts are seven model millimetres apart').toBeCloseTo(7, 4);
  expect(gap(joint.e6Face, joint.e5Face), 'Rendered mechanical mating faces share one point through articulation').toBeLessThan(.0001);
  expect(gap(joint.e6Face, joint.head)).toBeLessThan(.0001);
  expect(gap(joint.e5Face, joint.head)).toBeLessThan(.0001);
  return values;
}

async function completeOperation(page: Page, expectedGroups: number, maxMilliseconds = 26_000) {
  const phases = new Set<string>();
  for (let elapsed = 0; elapsed < maxMilliseconds; elapsed += 500) {
    await advance(page, 500);
    const current = await operation(page);
    if (current) phases.add(current.phase);
    else {
      expect(await groups(page)).toHaveLength(expectedGroups);
      return phases;
    }
  }
  throw new Error(`Coupling operation did not finish: ${JSON.stringify(await operation(page))}`);
}

test('the practice railway opens rigid nose covers, joins E5 and E6, drives curves, reverses, and separates', async ({ page }, info) => {
  const milestone = (stage: string) => console.info(`Coupling browser journey: ${stage}`);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await freeze(page);
  await seed(page, makeCouplingDemo());
  await page.getByRole('button', { name: 'Layouts', exact: true }).click();
  await page.getByRole('button', { name: /Coupling station/ }).click();
  await advance(page, 100);
  milestone('practice layout opened');
  const initial = await fleet(page);
  for (const value of initial) {
    expectRigid(value);
    expect(noseOf(value).state).toMatchObject({ open: 0, extension: 0, locked: false });
    expect(noseOf(value).coverTransforms.map(cover => cover.position)).toEqual([[0, 0, 0], [0, 0, 0]]);
  }
  await expect(page.getByRole('button', { name: 'Couple trains', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Couple trains', exact: true }).click();
  await advance(page, 700);
  await expectNoseView(page);
  const opening = await fleet(page);
  for (const value of opening) {
    const nose = noseOf(value);
    expect(nose.state.open).toBeGreaterThan(0);
    expect(nose.state.open).toBeLessThan(1);
    expect(nose.coverTransforms.map(cover => cover.position)).not.toEqual([[0, 0, 0], [0, 0, 0]]);
    expect(nose.coverTransforms.map(cover => cover.scale)).toEqual([[1, 1, 1], [1, 1, 1]]);
    expect(value.position, 'Opening covers works while the train body is stationary').toEqual(initial.find(before => before.id === value.id)!.position);
  }
  await expect(page.getByRole('button', { name: 'Run train', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Pause coupling', exact: true }).click();
  await advance(page, 100);
  const paused = await fleet(page);
  milestone('covers partly open and operation paused');
  const originalCamera = await expectNoseView(page);
  // Clicking the controls below the scene can scroll its center off screen.
  // Send real pointer input to the visible canvas, not the page header.
  await scene(page).scrollIntoViewIfNeeded();
  const bounds = (await scene(page).boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 110, bounds.y + bounds.height / 2 + 35, { steps: 8 });
  await page.mouse.up();
  await page.mouse.wheel(0, -300);
  await advance(page, 1600);
  const exploredCamera = await expectNoseView(page);
  expect(gap(exploredCamera.eye, originalCamera.eye), 'Nose view lets the child orbit the mechanism').toBeGreaterThan(10);
  expect(gap(exploredCamera.eye, exploredCamera.target), 'Nose view lets the child zoom toward the mechanism').toBeLessThan(gap(originalCamera.eye, originalCamera.target));
  await page.getByRole('button', { name: 'Nose view', exact: true }).click();
  await advance(page, 100);
  const resetCamera = await expectNoseView(page);
  expect(gap(resetCamera.eye, resetCamera.target), 'Choosing Nose view again restores the closeup distance').toBeCloseTo(Math.hypot(150, 20, 65), 3);
  await expect(page.getByRole('combobox', { name: 'Train car count', exact: true })).toBeDisabled();
  await expect(page.getByRole('combobox', { name: 'Train', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Remove selected train', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save layout', exact: true })).toBeDisabled();
  await scene(page).focus();
  await scene(page).press('r');
  await scene(page).press('Control+z');
  await scene(page).press('Delete');
  await advance(page, 500);
  expect((await operation(page))?.paused).toBe(true);
  expect((await fleet(page)).map(value => value.cars)).toEqual(paused.map(value => value.cars));
  await scene(page).press('Space');
  await advance(page, 16);
  expect((await operation(page))?.paused, 'Space safely continues the joining sequence rather than driving either train').toBe(false);
  expect((await fleet(page)).every(value => !value.running)).toBe(true);
  await scene(page).press('Space');
  await advance(page, 16);
  expect((await operation(page))?.paused).toBe(true);
  await page.getByRole('button', { name: 'Continue coupling', exact: true }).click();
  const phases = await completeOperation(page, 1);
  expect(phases.has('approaching')).toBe(true);
  expect(phases.has('locking')).toBe(true);
  const locked = await expectLocked(page);
  milestone('nose mechanisms locked');
  expect(locked.every(value => value.selected), 'Selecting either connected member highlights the complete formation').toBe(true);
  await driving(page).selectOption('coupling-demo-e5');
  await advance(page, 100);
  await page.getByRole('button', { name: 'Nose view', exact: true }).click();
  await advance(page, 300);
  await capture(page, info, 'e5-e6-locked-nose-joint');
  const slider = page.getByRole('slider', { name: 'Train speed', exact: true });
  await slider.focus(); await slider.press('End');
  await advance(page, 100);
  expect((await fleet(page)).map(value => value.requestedSpeed)).toEqual([320, 320]);
  await page.getByRole('button', { name: 'Run train', exact: true }).click();
  let articulated = false;
  const followingCamera = await expectNoseView(page);
  for (let time = 0; time < 3000; time += 300) {
    await advance(page, 300);
    const values = await expectLocked(page);
    expect(values.every(value => value.running)).toBe(true);
    expect(values[0].actualSpeed).toBeCloseTo(values[1].actualSpeed, 6);
    const joint = (await groups(page))[0].joint!;
    articulated ||= Math.abs(joint.e6Mount.y - joint.e5Mount.y) > .01;
    const followed = await expectNoseView(page);
    expect(gap(followed.eye, followed.target), 'Following the moving joint preserves the chosen camera distance').toBeCloseTo(gap(followingCamera.eye, followingCamera.target), 3);
  }
  expect(articulated, 'The connected noses really articulate on a curved rail').toBe(true);
  milestone('formation articulated through curve at shared speed');
  await capture(page, info, 'e5-e6-articulated-joint-on-curve');
  await page.getByRole('button', { name: 'Pause train', exact: true }).click();
  await advance(page, 100);
  const stopped = await fleet(page);
  await page.getByRole('button', { name: 'Reverse train direction', exact: true }).click();
  await advance(page, 100);
  const reversed = await expectLocked(page);
  expect(reversed.map(value => value.cars), 'Reversal changes travel without rearranging either trainset').toEqual(stopped.map(value => value.cars));
  expect(reversed.every(value => !value.cabForward)).toBe(true);
  await page.getByRole('button', { name: 'Run train', exact: true }).click();
  for (let time = 0; time < 3000; time += 300) { await advance(page, 300); await expectLocked(page); }
  await page.getByRole('button', { name: 'Pause train', exact: true }).click();
  await advance(page, 100);
  await expect(page.getByRole('button', { name: 'Decouple trains', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Decouple trains', exact: true }).click();
  milestone('reverse complete and separation started');
  const separating = await completeOperation(page, 0);
  milestone('separation and closing completed');
  expect(separating.has('separating')).toBe(true);
  expect(separating.has('closing')).toBe(true);
  const independent = await fleet(page);
  for (const value of independent) {
    expectRigid(value);
    expect(noseOf(value).state).toMatchObject({ open: 0, extension: 0, locked: false });
    expect(noseOf(value).coverTransforms.map(cover => cover.position)).toEqual([[0, 0, 0], [0, 0, 0]]);
  }
  expect((await saved(page)).couplings, 'The completed split persists independent placements').toEqual([]);
  const separatedSave = await saved(page);
  expect(separatedSave.trains.map((value: TrainSnapshot) => value.position)).toEqual(independent.map(value => value.position));
  await page.getByRole('button', { name: 'Undo last change', exact: true }).click();
  await advance(page, 100);
  const undoSplit = await expectLocked(page);
  expect(undoSplit.every(value => !value.running && value.actualSpeed === 0)).toBe(true);
  await page.getByRole('button', { name: 'Undo last change', exact: true }).click();
  await advance(page, 100);
  expect(await groups(page)).toEqual([]);
  const undoJoin = await fleet(page);
  expect(undoJoin.map(value => value.position), 'Undoing the join restores both original stopped rail references').toEqual(initial.map(value => value.position));
  expect(undoJoin.map(value => value.cars)).toEqual(initial.map(value => value.cars));
  await page.reload();
  await expect(scene(page)).toHaveAttribute('data-ready', 'true');
  await advance(page, 100);
  expect((await fleet(page)).map(value => value.cars)).toEqual(undoJoin.map(value => value.cars));
  expect((await fleet(page)).every(value => !value.running)).toBe(true);
  expect(errors).toEqual([]);
  milestone('undo and reload retained the original safe placements');
});

test('the authentic seventeen-car mixed formation saves, reloads stopped, and retains its articulated nose connection', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const value = makeCouplingDemo();
  const e6 = { ...value.trains![0], carCount: 7, requestedSpeed: 320 };
  const e5 = { ...value.trains![1], carCount: 10, requestedSpeed: 320 };
  const formation = solveCoupledFormation(value.tracks, e6, e5);
  expect(formation.complete).toBe(true);
  value.trains = [e6, { ...e5, position: formation.e5Position }];
  value.couplings = [{ id: 'our-authentic-formation', e6Id: e6.id, e5Id: e5.id }];
  value.selectedTrainId = e5.id;
  await freeze(page); await seed(page, value);
  const initial = await expectLocked(page);
  expect(initial.reduce((sum, train) => sum + train.carCount, 0)).toBe(17);
  await expect(page.getByRole('combobox', { name: 'Train car count', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Save layout', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Layout name', exact: true }).fill('Our seventeen-car Hayabusa and Komachi');
  await dialog.getByRole('button', { name: 'Save layout', exact: true }).click();
  await advance(page, 100);
  const stored = await saved(page);
  expect(stored.version).toBe(5);
  expect(stored.couplings).toEqual(value.couplings);
  expect(stored.trains.map((train: TrainSnapshot) => train.carCount)).toEqual([7, 10]);
  await page.reload();
  await expect(scene(page)).toHaveAttribute('data-ready', 'true');
  await advance(page, 100);
  const restored = await expectLocked(page);
  expect(restored.every(train => !train.running && train.actualSpeed === 0)).toBe(true);
  expect(restored.map(train => train.cars)).toEqual(initial.map(train => train.cars));
  await page.getByRole('button', { name: 'Nose view', exact: true }).click();
  await advance(page, 300);
  await page.getByRole('button', { name: 'Run train', exact: true }).click();
  for (let time = 0; time < 3500; time += 350) { await advance(page, 350); await expectLocked(page); }
  expect((await fleet(page)).every(train => train.running)).toBe(true);
  expect(gap((await fleet(page))[0].cars[0].center, restored[0].cars[0].center)).toBeGreaterThan(100);
  const joint = (await groups(page))[0].joint!;
  expect(Math.abs(joint.e6Mount.y - joint.e5Mount.y)).toBeGreaterThan(.01);
  await capture(page, info, 'seventeen-car-formation-nose-joint-on-curve');
  expect(errors).toEqual([]);
});

test('reloading during nose opening restores the original safe stopped placements and closed covers', async ({ page }) => {
  await freeze(page); await seed(page, makeCouplingDemo());
  const initial = await fleet(page);
  await page.getByRole('button', { name: 'Couple trains', exact: true }).click();
  await advance(page, 700);
  expect((await operation(page))?.phase).toBe('opening');
  expect((await fleet(page)).some(value => noseOf(value).state.open > 0)).toBe(true);
  expect((await saved(page)).couplings).toEqual([]);
  await page.reload();
  await expect(scene(page)).toHaveAttribute('data-ready', 'true');
  await advance(page, 100);
  expect(await operation(page)).toBeNull();
  expect(await groups(page)).toEqual([]);
  const recovered = await fleet(page);
  expect(recovered.map(value => value.position)).toEqual(initial.map(value => value.position));
  expect(recovered.map(value => value.cars)).toEqual(initial.map(value => value.cars));
  expect(recovered.every(value => !value.running && value.actualSpeed === 0)).toBe(true);
});

test('starting, inspecting, and continuing nose coupling brings the mechanism into the visible playground', async ({ page }, info) => {
  await freeze(page); await seed(page, makeCouplingDemo());
  const expectPlaygroundVisible = async () => {
    await expect.poll(() => scene(page).evaluate(element => {
      const bounds = element.getBoundingClientRect();
      return bounds.top >= -1 && bounds.bottom <= window.innerHeight + 1;
    }), { message: 'The child can see the complete scene after using coupling controls below it' }).toBe(true);
  };
  await page.getByRole('button', { name: 'Couple trains', exact: true }).click();
  await advance(page, 700);
  await expectPlaygroundVisible();
  expect((await operation(page))?.phase).toBe('opening');
  await expectNoseView(page);
  await capture(page, info, 'opening-nose-covers-visible-in-playground');
  await page.getByRole('button', { name: 'Pause coupling', exact: true }).click();
  await advance(page, 100);
  const paused = await fleet(page);
  await page.getByRole('button', { name: 'Nose view', exact: true }).click();
  await advance(page, 100);
  await expectPlaygroundVisible();
  expect((await operation(page))?.paused).toBe(true);
  expect((await fleet(page)).map(train => train.cars)).toEqual(paused.map(train => train.cars));
  await page.getByRole('button', { name: 'Continue coupling', exact: true }).click();
  await advance(page, 100);
  await expectPlaygroundVisible();
  expect((await operation(page))?.paused).toBe(false);
  expect((await fleet(page)).every(train => !train.running)).toBe(true);
});
