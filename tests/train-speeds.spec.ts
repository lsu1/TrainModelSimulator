import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { Track } from '../src/track';
import type { TrainSnapshot } from '../src/fleet';
import type { TrainType } from '../src/trains';

// Detailed retained models share one software-WebGL browser worker.
test.setTimeout(120_000);
const STORAGE_KEY = 'little-railways-layout-v5';
const SAVED_DESIGNS_KEY = 'little-railways-saved-designs-v1';
const MAX_SPEED: Record<TrainType, number> = { e235: 90, e5: 320, e6: 320, e7: 275 };
const scene = (page: Page) => page.getByRole('img', { name: '3D railway layout: rotate, zoom, select trains, and move Kato track pieces' });
const slider = (page: Page) => page.getByRole('slider', { name: 'Train speed', exact: true });
const trainCard = (page: Page, id: string) => page.getByRole('group', { name: 'Select a train to drive', exact: true }).locator(`button[data-train-id="${id}"]`);

type Runtime = TrainSnapshot & {
  running: boolean;
  actualSpeed: number;
  cars: { visible: boolean; center: { x: number; y: number; z: number } }[];
};

function line(prefix: string, y: number): Track[] {
  return Array.from({ length: 12 }, (_, index) => ({
    id: `${prefix}-${index}`, kind: 's248', x: index * 248, y, angle: 0,
    bend: 1, elevation: 0, endElevation: 0,
  }));
}

function train(type: TrainType, lane: number, requestedSpeed = 65): TrainSnapshot {
  return {
    id: `set-${lane}`, name: `${type.toUpperCase()} ${lane + 1}`, type, carCount: 3,
    position: { trackId: `lane-${lane}-4`, distance: 8, direction: 1, route: 0, laps: 0 },
    cabForward: true, requestedSpeed,
  };
}

function layout(trains: TrainSnapshot[]) {
  return {
    version: 3, name: 'Real train speeds', accessories: [],
    tracks: trains.flatMap((_, index) => line(`lane-${index}`, index * 90)),
    trains, selectedTrainId: trains[0]?.id, trainType: trains[0]?.type, carCount: 3,
  };
}

async function freeze(page: Page) {
  const time = new Date('2026-01-01T00:00:00Z');
  await page.clock.install({ time });
  await page.clock.pauseAt(new Date(time.getTime() + 1000));
}

async function advance(page: Page, milliseconds: number) {
  // Production caps a delayed animation frame at 100 ms.
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 100) {
    await page.clock.fastForward(Math.min(100, milliseconds - elapsed));
  }
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

async function fleet(page: Page): Promise<Runtime[]> {
  return scene(page).evaluate(element => JSON.parse((element as HTMLCanvasElement).dataset.fleetPoses ?? '[]'));
}

async function saved(page: Page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY);
}

async function select(page: Page, id: string) {
  await trainCard(page, id).click();
  await advance(page, 100);
  await expect(scene(page)).toHaveAttribute('data-selected-train-id', id);
}

test('each train has its operating speed limit and independent model-scale movement', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await freeze(page);
  const types: TrainType[] = ['e235', 'e5', 'e6', 'e7'];
  await seed(page, layout(types.map((type, index) => train(type, index))));
  for (const [index, type] of types.entries()) {
    await select(page, `set-${index}`);
    await expect(slider(page)).toHaveAttribute('max', String(MAX_SPEED[type]));
    await expect(page.locator('.speed-labels').getByText(`Max ${MAX_SPEED[type]} km/h`, { exact: true })).toBeVisible();
    await slider(page).focus();
    await slider(page).press('End');
    await expect(slider(page)).toHaveValue(String(MAX_SPEED[type]));
    await advance(page, 100);
    expect((await fleet(page))[index].requestedSpeed).toBe(MAX_SPEED[type]);
    await page.getByRole('button', { name: 'Run train', exact: true }).click();
  }
  await advance(page, 2400);
  const before = await fleet(page);
  expect(before.map(value => value.actualSpeed)).toEqual([90, 320, 320, 275]);
  await advance(page, 400);
  const after = await fleet(page);
  for (const [index, value] of after.entries()) {
    expect(value.requestedSpeed).toBe(MAX_SPEED[value.type]);
    expect(value.actualSpeed).toBe(MAX_SPEED[value.type]);
    expect(value.cars.every(car => car.visible)).toBe(true);
    const scale = value.type === 'e235' ? 150 : 160;
    const expectedDistance = MAX_SPEED[value.type] * 1000 / 3.6 / scale * .4;
    expect(Math.abs(value.cars[0].center.x - before[index].cars[0].center.x - expectedDistance), 'Rendered distance represents the displayed real-world speed at the model scale').toBeLessThan(3);
  }
  await select(page, 'set-0');
  await expect(slider(page)).toHaveValue('90');
  await expect(slider(page)).toHaveAttribute('max', '90');
  await slider(page).focus();
  await slider(page).press('Home');
  await advance(page, 100);
  expect((await fleet(page)).slice(1).map(value => value.requestedSpeed)).toEqual([320, 320, 275]);
  for (const [index] of types.entries()) {
    await select(page, `set-${index}`);
    await page.getByRole('button', { name: 'Pause train', exact: true }).click();
    await advance(page, 100);
  }
  const screenshot = testInfo.outputPath('independent-real-world-train-speeds.png');
  await page.screenshot({ path: screenshot });
  await testInfo.attach('real-world-speed-controls', { path: screenshot, contentType: 'image/png' });
  expect(errors).toEqual([]);
});

test('Shinkansen speeds above 120 and a zero request survive named saves, reload, backup and import', async ({ page }, testInfo) => {
  await freeze(page);
  const expectedSpeeds = [320, 320, 275, 0];
  const types: TrainType[] = ['e5', 'e6', 'e7', 'e235'];
  await seed(page, layout(types.map((type, index) => train(type, index, expectedSpeeds[index]))));
  expect((await fleet(page)).map(value => value.requestedSpeed)).toEqual(expectedSpeeds);
  await page.getByRole('button', { name: 'Save layout', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save your railway', exact: true });
  await dialog.getByRole('textbox', { name: 'Layout name', exact: true }).fill('Our express speeds');
  await dialog.getByRole('button', { name: 'Save layout', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const snapshot = await saved(page);
  const library = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), SAVED_DESIGNS_KEY);
  expect(library.designs[0].layout.trains.map((value: TrainSnapshot) => value.requestedSpeed)).toEqual(expectedSpeeds);
  await page.reload();
  await expect(scene(page)).toHaveAttribute('data-ready', 'true');
  await advance(page, 100);
  expect((await fleet(page)).map(value => value.requestedSpeed)).toEqual(expectedSpeeds);
  expect((await fleet(page)).every(value => !value.running && value.actualSpeed === 0)).toBe(true);
  const pendingDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save a layout file', exact: true }).click();
  const download = await pendingDownload;
  const filename = testInfo.outputPath('express-speeds.json');
  await download.saveAs(filename);
  const exported = JSON.parse(await readFile(filename, 'utf8'));
  expect(exported.trains).toEqual(snapshot.trains);
  await page.getByRole('button', { name: 'Remove selected train', exact: true }).click();
  await page.getByLabel('Open railway file').setInputFiles(filename);
  await advance(page, 100);
  expect((await fleet(page)).map(value => value.requestedSpeed)).toEqual(expectedSpeeds);
  expect((await fleet(page)).map(value => value.position)).toEqual(snapshot.trains.map((value: TrainSnapshot) => value.position));
  await page.getByRole('button', { name: 'Layouts', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Open saved layout Our express speeds', exact: true }).click();
  await advance(page, 100);
  expect((await fleet(page)).map(value => value.requestedSpeed)).toEqual(expectedSpeeds);
  await select(page, 'set-3');
  expect((await fleet(page))[3].requestedSpeed).toBe(0);
  expect((await saved(page)).trains[3].requestedSpeed).toBe(0);
});

test('an old 120 km/h Yamanote request and a model change clamp safely without relocating trains', async ({ page }) => {
  await freeze(page);
  await seed(page, layout([train('e235', 0, 120), train('e5', 1, 320)]));
  const loaded = await fleet(page);
  expect(loaded.map(value => value.requestedSpeed)).toEqual([90, 320]);
  expect(loaded.every(value => value.position !== null)).toBe(true);
  expect(loaded.every(value => !value.running && value.actualSpeed === 0)).toBe(true);
  await select(page, 'set-1');
  await expect(slider(page)).toHaveValue('320');
  await page.getByRole('combobox', { name: 'Train', exact: true }).selectOption('e235');
  await advance(page, 100);
  await expect(slider(page)).toHaveAttribute('max', '90');
  await expect(slider(page)).toHaveValue('90');
  const changed = await fleet(page);
  expect(changed[1].requestedSpeed).toBe(90);
  expect(changed[1].position).toEqual(loaded[1].position);
  expect(changed[0].cars).toEqual(loaded[0].cars);
  expect((await saved(page)).trains.map((value: TrainSnapshot) => value.requestedSpeed)).toEqual([90, 90]);
  await page.getByRole('combobox', { name: 'Train', exact: true }).selectOption('e7');
  await advance(page, 100);
  await expect(slider(page)).toHaveAttribute('max', '275');
  await expect(slider(page)).toHaveValue('90');
});
