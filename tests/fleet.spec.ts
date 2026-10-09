import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { Track } from '../src/track';
import { getCouplingLinkLength, getTrainCarSpec, getTrainSpec } from '../src/trains';
import type { TrainType } from '../src/trains';
import type { TrainSnapshot } from '../src/fleet';

// One software-WebGL worker keeps the retained multi-train models affordable.
test.setTimeout(120_000);
const STORAGE_KEY = 'little-railways-layout-v5';
const scene = (page: Page) => page.getByRole('img', { name: '3D railway layout: rotate, zoom, select trains, and move Kato track pieces' });
const trainCard = (page: Page, id: string) => page.getByRole('group', { name: 'Select a train to drive', exact: true }).locator(`button[data-train-id="${id}"]`);

type Point = { x: number; y: number; z: number };
type Car = {
  index: number; visible: boolean; model: string; length: number; bogieOffset: number;
  cab: boolean; noseDirection: number; scale: number;
  center: Point; frontBogie: Point; rearBogie: Point; frontEnd: Point; rearEnd: Point;
};
type Coupler = { index: number; visible: boolean; front: Point; rear: Point };
type RenderedTrain = TrainSnapshot & {
  status: string; running: boolean; actualSpeed: number; stopReason?: string;
  cars: Car[]; couplers: Coupler[];
};
const gap = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function line(prefix: string, y: number, pieces = 16, elevation = 0): Track[] {
  return Array.from({ length: pieces }, (_, index) => ({
    id: `${prefix}-${index}`, kind: 's248', x: index * 248, y, angle: 0,
    bend: 1, elevation, endElevation: elevation,
  }));
}

function train(id: string, type: TrainType, prefix: string, distance = 1000, patch: Partial<TrainSnapshot> = {}): TrainSnapshot {
  const index = Math.floor(distance / 248);
  return {
    id, name: `${getTrainSpec(type).model} ${id}`, type, carCount: 3,
    position: { trackId: `${prefix}-${index}`, distance: distance - index * 248, direction: 1, route: 0, laps: 0 },
    cabForward: true, requestedSpeed: 65, ...patch,
  };
}

function layout(tracks: Track[], trains: TrainSnapshot[], selectedTrainId = trains[0]?.id) {
  const selected = trains.find(value => value.id === selectedTrainId) ?? trains[0];
  return {
    version: 3, name: 'Our independent trains', tracks, accessories: [], trains, selectedTrainId,
    trainType: selected?.type ?? 'e235', carCount: selected?.carCount ?? 3,
  };
}

async function seed(page: Page, value: object, key = STORAGE_KEY) {
  await page.addInitScript(({ value, key }) => {
    if (!localStorage.getItem('little-railways-layout-v5')) localStorage.setItem(key, JSON.stringify(value));
  }, { value, key });
  await page.goto('/');
  await expect(scene(page)).toHaveAttribute('data-ready', 'true');
}

async function freeze(page: Page) {
  const time = new Date('2026-01-01T00:00:00Z');
  await page.clock.install({ time });
  await page.clock.pauseAt(time);
}

async function advance(page: Page, milliseconds: number) {
  // The shared clock caps a delayed frame at 100 ms; use real bounded steps.
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 100) await page.clock.fastForward(Math.min(100, milliseconds - elapsed));
  await page.clock.fastForward(16);
}

async function fleet(page: Page): Promise<RenderedTrain[]> {
  return scene(page).evaluate(element => JSON.parse((element as HTMLCanvasElement).dataset.fleetPoses ?? '[]'));
}

async function saved(page: Page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY);
}

async function select(page: Page, id: string) {
  await trainCard(page, id).click();
  await advance(page, 16);
  await expect(scene(page)).toHaveAttribute('data-selected-train-id', id);
}

async function speed(page: Page, value: number) {
  const slider = page.getByRole('slider', { name: 'Train speed', exact: true });
  await slider.focus();
  await slider.press('Home');
  for (let current = 5; current < value; current += 5) await slider.press('ArrowRight');
  await expect(slider).toHaveValue(String(value));
}

function expectGeometry(value: RenderedTrain) {
  expect(value.cars).toHaveLength(value.carCount);
  expect(value.couplers).toHaveLength(value.carCount - 1);
  for (const car of value.cars) {
    const spec = getTrainCarSpec(value.type, car.index, value.carCount);
    expect(car.visible, `${value.name}: car ${car.index + 1} remains on the rails`).toBe(true);
    expect(car.model).toBe(getTrainSpec(value.type).model);
    expect(car.length).toBeCloseTo(spec.length, 3);
    expect(gap(car.frontEnd, car.rearEnd), 'Each existing body stays rigid').toBeCloseTo(spec.length, 1);
    expect(gap(car.frontBogie, car.rearBogie), 'Each train retains its own bogie chord').toBeCloseTo(spec.bogieOffset * 2, 1);
    expect(car.cab).toBe(car.index === 0 || car.index === value.carCount - 1);
  }
  for (const coupling of value.couplers) {
    expect(coupling.visible).toBe(true);
    expect(gap(coupling.front, coupling.rear)).toBeCloseTo(getCouplingLinkLength(value.type, coupling.index, value.carCount), 1);
  }
}

function bodyInterval(value: RenderedTrain) {
  const points = value.cars.filter(car => car.visible).flatMap(car => [car.frontEnd.x, car.rearEnd.x]);
  return { min: Math.min(...points), max: Math.max(...points) };
}

async function pick(page: Page, attribute: 'pickPoints' | 'trainPickPoints', id: string) {
  const canvas = scene(page);
  await canvas.scrollIntoViewIfNeeded();
  await expect.poll(async () => canvas.evaluate((element, value) => !!JSON.parse((element as HTMLCanvasElement).dataset[value.attribute] ?? '{}')[value.id], { attribute, id })).toBe(true);
  const coordinates = await canvas.evaluate((element, value) => {
    const point = JSON.parse((element as HTMLCanvasElement).dataset[value.attribute]!)[value.id];
    const bounds = element.getBoundingClientRect();
    return { x: bounds.x + point.x, y: bounds.y + point.y };
  }, { attribute, id });
  await page.mouse.move(coordinates.x, coordinates.y);
  await advance(page, 16);
  return coordinates;
}

test('all four preserved train models and a second E5 retain distinct identities and rigid formations', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await freeze(page);
  const types: TrainType[] = ['e235', 'e5', 'e6', 'e7', 'e5'];
  const trains = types.map((type, index) => train(`set-${index}`, type, `lane-${index}`));
  await seed(page, layout(types.flatMap((_, index) => line(`lane-${index}`, index * 90)), trains));
  await advance(page, 100);
  await expect(page.getByRole('group', { name: 'Select a train to drive', exact: true }).getByRole('button')).toHaveCount(5);
  expect((await fleet(page)).map(value => value.id)).toEqual(trains.map(value => value.id));
  for (const value of await fleet(page)) expectGeometry(value);
  const initial = await fleet(page);
  for (const value of trains) {
    await select(page, value.id);
    await expect(page.getByRole('combobox', { name: 'Train', exact: true })).toHaveValue(value.type);
    expect((await fleet(page)).map(({ cars, couplers }) => ({ cars, couplers })), 'Selection preserves every existing model and pose').toEqual(initial.map(({ cars, couplers }) => ({ cars, couplers })));
  }
  const screenshot = testInfo.outputPath('all-four-models-and-two-e5-trains.png');
  await scene(page).screenshot({ path: screenshot });
  await testInfo.attach('independent-models', { path: screenshot, contentType: 'image/png' });
  await select(page, 'set-2');
  await page.getByRole('button', { name: 'Train view', exact: true }).click();
  await advance(page, 200);
  const closeup = testInfo.outputPath('mixed-fleet-train-view.png');
  await scene(page).screenshot({ path: closeup });
  await testInfo.attach('mixed-fleet-train-view', { path: closeup, contentType: 'image/png' });
  const panel = testInfo.outputPath('desktop-train-list.png');
  await page.getByRole('region', { name: 'Your trains' }).screenshot({ path: panel });
  await testInfo.attach('desktop-train-list', { path: panel, contentType: 'image/png' });
  expect(errors).toEqual([]);
});

test('independent controls, scene selection and removal leave the other journey intact', async ({ page }) => {
  await freeze(page);
  await seed(page, layout([...line('green', 0), ...line('red', 90)], [train('green-set', 'e5', 'green'), train('red-set', 'e6', 'red')]));
  await advance(page, 100);
  await speed(page, 30);
  await page.getByRole('button', { name: 'Run train', exact: true }).click();
  await advance(page, 500);
  const onlyGreen = await fleet(page);
  expect(onlyGreen[0].actualSpeed).toBeGreaterThan(0);
  expect(onlyGreen[1].actualSpeed).toBe(0);
  const parkedRed = onlyGreen[1].cars;
  await select(page, 'red-set');
  await speed(page, 90);
  await page.getByRole('button', { name: 'Run train', exact: true }).click();
  await advance(page, 700);
  const both = await fleet(page);
  expect(both[0].requestedSpeed).toBe(30);
  expect(both[1].requestedSpeed).toBe(90);
  expect(gap(both[1].cars[0].center, parkedRed[0].center)).toBeGreaterThan(5);
  await select(page, 'green-set');
  await expect(page.getByRole('slider', { name: 'Train speed' })).toHaveValue('30');
  await page.getByRole('button', { name: 'Pause train', exact: true }).click();
  await advance(page, 100);
  const stoppedGreen = (await fleet(page))[0].cars;
  const redBefore = (await fleet(page))[1].cars[0].center;
  await advance(page, 500);
  expect((await fleet(page))[0].cars).toEqual(stoppedGreen);
  expect(gap((await fleet(page))[1].cars[0].center, redBefore)).toBeGreaterThan(5);
  await page.getByRole('button', { name: 'Pause all trains', exact: true }).click();
  await advance(page, 100);
  await page.getByRole('button', { name: 'Top view', exact: true }).click();
  await advance(page, 500);
  const target = await pick(page, 'trainPickPoints', 'red-set');
  await page.mouse.click(target.x, target.y);
  await advance(page, 100);
  await expect(trainCard(page, 'red-set')).toHaveAttribute('aria-pressed', 'true');
  const greenBeforeRemoval = (await fleet(page))[0];
  await page.getByRole('button', { name: 'Remove selected train', exact: true }).click();
  await advance(page, 100);
  expect((await fleet(page)).map(value => value.id)).toEqual(['green-set']);
  expect((await fleet(page))[0].cars).toEqual(greenBeforeRemoval.cars);
  expect((await fleet(page))[0].requestedSpeed).toBe(30);
});

test('Add train supports repeated models while an overlapping manual placement is rejected', async ({ page }) => {
  await freeze(page);
  await seed(page, layout([...line('main', 0), ...line('other', 90)], [train('first', 'e5', 'main', 1000)]));
  await page.getByRole('button', { name: 'Prepare a new train', exact: true }).click();
  await page.getByRole('combobox', { name: 'New train model', exact: true }).selectOption('e5');
  await page.getByRole('combobox', { name: 'New train car count', exact: true }).selectOption('3');
  await page.getByRole('button', { name: 'Add train', exact: true }).click();
  await advance(page, 100);
  const added = (await fleet(page)).find(value => value.id !== 'first')!;
  expect(added.type).toBe('e5');
  expect(added.position).not.toBeNull();
  expectGeometry(added);
  expect(added.id).not.toBe('first');
  const before = await fleet(page);
  await page.getByRole('button', { name: 'Top view', exact: true }).click();
  await advance(page, 500);
  await page.getByRole('button', { name: 'Place selected train', exact: true }).click();
  // This piece's center is within the first formation's occupied body span.
  const occupied = await pick(page, 'pickPoints', 'main-3');
  await expect.poll(async () => scene(page).evaluate(element => JSON.parse((element as HTMLCanvasElement).dataset.trainPlacement ?? 'null')?.allowed)).toBe(false);
  await page.mouse.click(occupied.x, occupied.y);
  await advance(page, 100);
  expect((await fleet(page)).map(value => value.position), 'Rejected placement retains both track references').toEqual(before.map(value => value.position));
  await expect(page.getByRole('button', { name: 'Cancel train placement', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel train placement', exact: true }).click();
  await advance(page, 100);
  expect((await fleet(page)).map(value => value.cars)).toEqual(before.map(value => value.cars));
});

test('two opposing high-speed trains stop without passing through one another across track boundaries', async ({ page }) => {
  await freeze(page);
  const first = train('east', 'e5', 'main', 1100, { requestedSpeed: 120 });
  const second = train('west', 'e6', 'main', 1700, { requestedSpeed: 120 });
  second.position = { ...second.position!, direction: -1 };
  await seed(page, layout(line('main', 0), [first, second]));
  await page.getByRole('button', { name: 'Run train', exact: true }).click();
  await select(page, 'west');
  await page.getByRole('button', { name: 'Run train', exact: true }).click();
  let previous = await fleet(page);
  for (let step = 0; step < 20; step += 1) {
    await advance(page, 250);
    const value = await fleet(page);
    value.forEach(expectGeometry);
    expect(bodyInterval(value[1]).min - bodyInterval(value[0]).max, 'Opposing rigid bodies never overlap').toBeGreaterThanOrEqual(0);
    for (let index = 0; index < value.length; index += 1) expect(gap(value[index].cars[0].center, previous[index].cars[0].center), 'Safety does not teleport either train').toBeLessThan(80);
    previous = value;
  }
  expect(previous.some(value => value.status === 'blocked')).toBe(true);
  expect(previous.every(value => value.actualSpeed === 0)).toBe(true);
  const stopped = previous.map(value => value.cars);
  await advance(page, 500);
  expect((await fleet(page)).map(value => value.cars)).toEqual(stopped);
});

test('a fast follower waits behind a parked train and can restart once the obstruction moves', async ({ page }) => {
  await freeze(page);
  await seed(page, layout(line('main', 0), [
    train('follower', 'e235', 'main', 1000, { requestedSpeed: 120 }),
    train('leader', 'e235', 'main', 1500, { requestedSpeed: 65 }),
  ]));
  await page.getByRole('button', { name: 'Run train', exact: true }).click();
  for (let step = 0; step < 16; step += 1) {
    await advance(page, 250);
    const value = await fleet(page);
    expect(bodyInterval(value[1]).min - bodyInterval(value[0]).max, 'Following train remains behind the parked body').toBeGreaterThanOrEqual(0);
  }
  const waiting = await fleet(page);
  expect(waiting[0].status).toBe('blocked');
  expect(waiting[0].actualSpeed).toBe(0);
  expect(waiting[1].position).toEqual(train('leader', 'e235', 'main', 1500).position);
  await select(page, 'leader');
  await page.getByRole('button', { name: 'Run train', exact: true }).click();
  await advance(page, 1500);
  await select(page, 'follower');
  await page.getByRole('button', { name: 'Run train', exact: true }).click();
  await advance(page, 500);
  const resumed = await fleet(page);
  expect(gap(resumed[0].cars[0].center, waiting[0].cars[0].center)).toBeGreaterThan(5);
  expect(bodyInterval(resumed[1]).min - bodyInterval(resumed[0]).max).toBeGreaterThanOrEqual(0);
});

test('parallel trains and a ground train beneath an elevated train can move simultaneously', async ({ page }) => {
  await freeze(page);
  const tracks = [...line('upper', 0, 16, 60), ...line('ground', 0), ...line('parallel', 33)];
  await seed(page, layout(tracks, [train('upper-set', 'e7', 'upper'), train('ground-set', 'e235', 'ground'), train('parallel-set', 'e6', 'parallel')]));
  await advance(page, 100);
  const initial = await fleet(page);
  for (const id of ['upper-set', 'ground-set', 'parallel-set']) {
    await select(page, id);
    await page.getByRole('button', { name: 'Run train', exact: true }).click();
  }
  await advance(page, 1000);
  const moving = await fleet(page);
  moving.forEach(expectGeometry);
  for (let index = 0; index < moving.length; index += 1) {
    expect(moving[index].actualSpeed).toBeGreaterThan(0);
    expect(gap(moving[index].cars[0].center, initial[index].cars[0].center)).toBeGreaterThan(20);
  }
  expect(moving[0].cars[0].frontBogie.z - moving[1].cars[0].frontBogie.z).toBeCloseTo(60, 3);
});

test('a parked train protects its turnout while an unrelated train remains unchanged', async ({ page }) => {
  await freeze(page);
  const main = line('main', 0);
  main[4] = { ...main[4], kind: 't4l', bend: -1, switchNumber: 1, switchState: 'straight' };
  // The turnout is 126 mm rather than S248's length. The parked cab and its
  // trailing cars occupy only this piece and the uninterrupted approach.
  const occupying = train('parked', 'e235', 'main', 1020);
  await seed(page, layout([...main, ...line('away', 90)], [occupying, train('away-set', 'e6', 'away')]));
  await advance(page, 100);
  await select(page, 'away-set');
  const before = await fleet(page);
  const desk = page.getByRole('region', { name: 'Turnout switch controls' });
  await desk.getByRole('button', { name: 'Switch 1 branch', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Switch 1 is occupied');
  await expect(desk.getByRole('button', { name: 'Switch 1 straight', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await advance(page, 100);
  expect((await fleet(page)).map(value => value.cars)).toEqual(before.map(value => value.cars));
});

test('occupied track edits are rejected and adding a remote piece preserves both parked trains', async ({ page }) => {
  await freeze(page);
  await seed(page, layout([...line('main', 0), ...line('away', 90)], [train('first', 'e5', 'main'), train('second', 'e235', 'away')]));
  await advance(page, 100);
  const before = await fleet(page);
  const original = await saved(page);
  await page.locator('details.inventory > summary').click();
  await page.getByRole('button', { name: 'Select placed 248 mm straight', exact: true }).nth(3).click();
  await page.getByLabel('Selected piece height', { exact: true }).fill('60');
  await expect(page.getByRole('alert')).toContainText('This track is occupied');
  expect((await saved(page)).tracks).toEqual(original.tracks);
  await page.getByRole('button', { name: 'Rotate selected piece', exact: true }).click();
  // The geometry guard may reject the rotated piece before the occupancy
  // guard because its bed would intersect the adjacent connected rails.
  await expect(page.getByRole('alert')).toContainText(/This track is occupied|These tracks overlap/);
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('This track is occupied');
  expect((await saved(page)).tracks).toEqual(original.tracks);
  await page.getByRole('button', { name: 'Deselect piece', exact: true }).click();
  await page.getByRole('button', { name: 'Add 248 mm straight', exact: true }).click();
  await advance(page, 100);
  expect((await saved(page)).tracks).toHaveLength(original.tracks.length + 1);
  expect((await fleet(page)).map(value => value.position), 'A remote addition retains every rail reference').toEqual(before.map(value => value.position));
  expect((await fleet(page)).map(value => value.cars), 'Neither parked formation is relocated by editing').toEqual(before.map(value => value.cars));
});

test('Undo restores train identities and poses after adding, removing and changing a model', async ({ page }) => {
  await freeze(page);
  await seed(page, layout([...line('main', 0), ...line('other', 90)], [train('first', 'e5', 'main'), train('second', 'e6', 'other')]));
  await advance(page, 100);
  const original = await fleet(page);
  await page.getByRole('button', { name: 'Prepare a new train', exact: true }).click();
  await page.getByRole('combobox', { name: 'New train model', exact: true }).selectOption('e7');
  await page.getByRole('button', { name: 'Add train', exact: true }).click();
  await advance(page, 100);
  const added = await fleet(page);
  expect(added).toHaveLength(3);
  await page.getByRole('button', { name: 'Remove selected train', exact: true }).click();
  await advance(page, 100);
  expect((await fleet(page)).map(value => value.id)).toEqual(['first', 'second']);
  await page.getByRole('button', { name: 'Undo last change', exact: true }).click();
  await advance(page, 100);
  expect((await fleet(page)).map(value => ({ id: value.id, cars: value.cars }))).toEqual(added.map(value => ({ id: value.id, cars: value.cars })));
  await page.getByRole('button', { name: 'Undo last change', exact: true }).click();
  await advance(page, 100);
  expect((await fleet(page)).map(value => ({ id: value.id, cars: value.cars }))).toEqual(original.map(value => ({ id: value.id, cars: value.cars })));
  await select(page, 'first');
  await page.getByRole('combobox', { name: 'Train', exact: true }).selectOption('e235');
  await advance(page, 100);
  expect((await fleet(page))[0].type).toBe('e235');
  await page.getByRole('button', { name: 'Undo last change', exact: true }).click();
  await advance(page, 100);
  expect((await fleet(page)).map(value => ({ id: value.id, type: value.type, cars: value.cars }))).toEqual(original.map(value => ({ id: value.id, type: value.type, cars: value.cars })));
});

test('removing the last train from Train view leaves the railway camera usable', async ({ page }) => {
  await freeze(page);
  await seed(page, layout(line('main', 0), [train('only', 'e5', 'main')]));
  await page.getByRole('button', { name: 'Train view', exact: true }).click();
  await advance(page, 200);
  await page.getByRole('button', { name: 'Remove selected train', exact: true }).click();
  await advance(page, 200);
  await expect(page.getByRole('button', { name: 'Train view', exact: true })).toBeDisabled();
  const canvas = scene(page);
  await canvas.scrollIntoViewIfNeeded();
  const before = await canvas.getAttribute('data-pick-points');
  const bounds = (await canvas.boundingBox())!;
  const x = bounds.x + bounds.width * .6, y = bounds.y + bounds.height * .4;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 90, y - 50, { steps: 6 });
  await page.mouse.up();
  await advance(page, 300);
  await expect.poll(() => canvas.getAttribute('data-pick-points')).not.toBe(before);
  expect(await fleet(page)).toHaveLength(0);
});

test('fleet identity, positions, directions and speeds survive named saves, file backup and paused reload', async ({ page }, testInfo) => {
  await freeze(page);
  const second = train('second', 'e6', 'other', 1600, { requestedSpeed: 40 });
  second.position = { ...second.position!, direction: -1 };
  await seed(page, layout([...line('main', 0), ...line('other', 90)], [train('first', 'e5', 'main', 1000, { requestedSpeed: 90 }), second], 'second'));
  await page.getByRole('button', { name: 'Run train', exact: true }).click();
  await advance(page, 500);
  await page.getByRole('button', { name: 'Save layout', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save your railway', exact: true });
  await dialog.getByRole('textbox', { name: 'Layout name', exact: true }).fill('Two independent Shinkansen');
  await dialog.getByRole('button', { name: 'Save layout', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await advance(page, 100);
  const snapshot = await saved(page);
  expect(snapshot.version).toBe(5);
  expect(snapshot.trains).toHaveLength(2);
  expect(snapshot.selectedTrainId).toBe('second');
  expect(snapshot.trains.every((value: Record<string, unknown>) => value.actualSpeed === undefined && value.running === undefined)).toBe(true);
  await page.reload();
  await expect(scene(page)).toHaveAttribute('data-ready', 'true');
  await advance(page, 100);
  const restored = await fleet(page);
  expect(restored.map(value => value.position)).toEqual(snapshot.trains.map((value: TrainSnapshot) => value.position));
  expect(restored.map(value => value.requestedSpeed)).toEqual([90, 40]);
  expect(restored.every(value => value.actualSpeed === 0 && !value.running)).toBe(true);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save a layout file', exact: true }).click();
  const download = await downloadPromise;
  const file = testInfo.outputPath('two-train-layout.json');
  await download.saveAs(file);
  const exported = JSON.parse(await readFile(file, 'utf8'));
  expect(exported.trains).toEqual(snapshot.trains);
  expect(exported.savedDesignId).toBeUndefined();
  await page.getByRole('button', { name: 'Remove selected train', exact: true }).click();
  await page.getByLabel('Open railway file').setInputFiles(file);
  await advance(page, 100);
  expect((await fleet(page)).map(value => value.id)).toEqual(['first', 'second']);
  await page.getByRole('button', { name: 'Layouts', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Open saved layout Two independent Shinkansen', exact: true }).click();
  await advance(page, 100);
  expect((await fleet(page)).map(value => value.position)).toEqual(snapshot.trains.map((value: TrainSnapshot) => value.position));
});

test('version 2 layouts migrate to one independent E235 and a long fleet remains usable on a small screen', async ({ page }, testInfo) => {
  await freeze(page);
  const tracks = line('legacy', 0);
  await seed(page, { version: 2, name: 'Our old railway', tracks: [tracks[8], ...tracks.filter(value => value !== tracks[8])], accessories: [], carCount: 11 }, 'little-railways-layout-v2');
  await advance(page, 100);
  const migrated = await saved(page);
  expect(migrated.version).toBe(5);
  expect(migrated.trains).toHaveLength(1);
  expect(migrated.trains[0].type).toBe('e235');
  expect(migrated.trains[0].carCount).toBe(11);
  expectGeometry((await fleet(page))[0]);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('region', { name: 'Your trains' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Prepare a new train', exact: true }).click();
  await page.getByRole('combobox', { name: 'New train model', exact: true }).selectOption('e7');
  await page.getByRole('combobox', { name: 'New train car count', exact: true }).selectOption('11');
  await page.getByRole('button', { name: 'Add train', exact: true }).click();
  await advance(page, 100);
  const value = await fleet(page);
  expect(value).toHaveLength(2);
  expectGeometry(value[1]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const panel = testInfo.outputPath('mobile-train-list.png');
  await page.getByRole('region', { name: 'Your trains' }).screenshot({ path: panel });
  await testInfo.attach('mobile-train-list', { path: panel, contentType: 'image/png' });
});
