import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { KATO_CATALOG } from '../src/catalog';
import type { TrainSnapshot } from '../src/fleet';
import type { LayoutData, PlacedAccessory } from '../src/layout';
import type { Track } from '../src/track';

// Keep scenes small and advance the frozen train clock only when needed so the
// feature can also be exercised with software WebGL on a single browser worker.
test.setTimeout(180_000);
const STORAGE_KEY = 'little-railways-layout-v5';
const scene = (page: Page) => page.getByRole('img', { name: '3D railway layout: rotate, zoom, select trains, and move Kato track pieces' });
const nameInput = (page: Page) => page.getByRole('textbox', { name: 'Station name', exact: true });
const applyButton = (page: Page) => page.getByRole('button', { name: 'Apply station name', exact: true });
const resetButton = (page: Page) => page.getByRole('button', { name: 'Reset station name', exact: true });
type RenderedTrain = TrainSnapshot & { running: boolean; actualSpeed: number; cars: { visible: boolean }[] };

function accessories(): PlacedAccessory[] {
  return [
    { id: 'named-platform', kind: 'a-platform', x: 0, y: 100, angle: 0, elevation: 0 },
    { id: 'named-station', kind: 'a-station', x: 0, y: 250, angle: 0, elevation: 0 },
    { id: 'named-open-platform', kind: 'a-platform-open', x: 290, y: 100, angle: 0, elevation: 0 },
    { id: 'named-end-platform', kind: 'a-platform-end', x: -245, y: 100, angle: 0, elevation: 0 },
    { id: 'unnamed-catenary', kind: 'a-catenary', x: 400, y: 250, angle: 0, elevation: 0 },
  ];
}

function layout(withTrain = false): LayoutData {
  const tracks: Track[] = withTrain ? Array.from({ length: 8 }, (_, index) => ({
    id: `main-${index}`, kind: 's248', x: index * 248, y: 0, angle: 0,
    bend: 1, elevation: 0, endElevation: 0,
  })) : [];
  const trains: TrainSnapshot[] = withTrain ? [{
    id: 'moving-yamanote', name: 'Continuing Yamanote', type: 'e235', carCount: 3,
    position: { trackId: 'main-3', distance: 150, direction: 1, route: 0, laps: 0 },
    cabForward: true, requestedSpeed: 20,
  }] : [];
  return {
    version: 5, name: 'Station names', tracks, accessories: withTrain ? [accessories()[0]] : accessories(),
    trains, couplings: [], trainType: 'e235', carCount: 3,
    ...(withTrain ? { selectedTrainId: 'moving-yamanote' } : {}),
  };
}

async function freeze(page: Page) {
  const time = new Date('2026-01-01T00:00:00Z');
  await page.clock.install({ time });
  await page.clock.pauseAt(time);
}

async function advance(page: Page, milliseconds = 16) {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 100) {
    await page.clock.fastForward(Math.min(100, milliseconds - elapsed));
  }
  await page.clock.fastForward(16);
}

async function seed(page: Page, value: LayoutData) {
  await page.addInitScript(({ key, value }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value));
  }, { key: STORAGE_KEY, value });
  await page.goto('/');
  await expect(scene(page)).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await advance(page);
}

async function selectAccessory(page: Page, kind: string) {
  const inventory = page.locator('details.inventory');
  if (!await inventory.evaluate(element => (element as HTMLDetailsElement).open)) {
    await inventory.locator('summary').click();
  }
  const spec = KATO_CATALOG.find(item => item.kind === kind)!;
  await page.getByRole('button', { name: `Select placed ${spec.name}`, exact: true }).click();
  await advance(page);
}

async function signs(page: Page): Promise<Record<string, string>> {
  return scene(page).evaluate(element => Object.fromEntries(
    JSON.parse((element as HTMLCanvasElement).dataset.stationSigns ?? '[]')
      .map((sign: { id: string; name: string }) => [sign.id, sign.name]),
  ));
}

async function saved(page: Page): Promise<LayoutData> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY);
}

async function expectSign(page: Page, id: string, name: string) {
  await expect.poll(async () => (await signs(page))[id], { timeout: 30_000 }).toBe(name);
}

async function applyName(page: Page, name: string) {
  await nameInput(page).fill(name);
  await applyButton(page).click();
  await advance(page);
}

async function movingTrain(page: Page): Promise<RenderedTrain> {
  return scene(page).evaluate(element => JSON.parse((element as HTMLCanvasElement).dataset.fleetPoses ?? '[]')[0]);
}

function distance(train: RenderedTrain): number {
  return Number(train.position!.trackId.split('-').at(-1)) * 248 + train.position!.distance;
}

async function expectWithinWidth(page: Page, control: Locator) {
  await control.scrollIntoViewIfNeeded();
  const bounds = await control.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
}

test('station signs can be renamed independently, undone, reset, and retained through file round trips', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await freeze(page);
  await seed(page, layout());
  expect(await signs(page)).toEqual({
    'named-platform': '原宿 Harajuku', 'named-station': '東京 Tokyo',
    'named-open-platform': '原宿 Harajuku',
  });
  await selectAccessory(page, 'a-platform');
  await expect(nameInput(page)).toHaveValue('原宿 Harajuku');
  await expect(applyButton(page)).toBeDisabled();
  await expect(resetButton(page)).toBeDisabled();
  await applyName(page, '  品川   Shinagawa  ');
  await expect(nameInput(page)).toHaveValue('品川 Shinagawa');
  await expectSign(page, 'named-platform', '品川 Shinagawa');
  await expectSign(page, 'named-station', '東京 Tokyo');
  expect((await saved(page)).accessories.find(item => item.id === 'named-platform')!.stationName).toBe('品川 Shinagawa');

  await page.getByRole('button', { name: 'Undo last change', exact: true }).click();
  await advance(page);
  await expectSign(page, 'named-platform', '原宿 Harajuku');
  expect((await saved(page)).accessories.find(item => item.id === 'named-platform')).not.toHaveProperty('stationName');
  await selectAccessory(page, 'a-platform');
  await applyName(page, '渋谷 Shibuya');
  await resetButton(page).click();
  await advance(page);
  await expect(nameInput(page)).toHaveValue('原宿 Harajuku');
  await expectSign(page, 'named-platform', '原宿 Harajuku');
  expect((await saved(page)).accessories.find(item => item.id === 'named-platform')).not.toHaveProperty('stationName');
  await applyName(page, '京都 Kyoto');
  await selectAccessory(page, 'a-station');
  await expect(nameInput(page)).toHaveValue('東京 Tokyo');
  await applyName(page, 'Central Station');
  await expectSign(page, 'named-platform', '京都 Kyoto');
  await expectSign(page, 'named-station', 'Central Station');
  const beforeReload = await saved(page);
  await page.reload();
  await expect(scene(page)).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await advance(page);
  await expectSign(page, 'named-platform', '京都 Kyoto');
  await expectSign(page, 'named-station', 'Central Station');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save a layout file', exact: true }).click();
  const exportPath = info.outputPath('station-names.json');
  await (await downloadPromise).saveAs(exportPath);
  expect(JSON.parse(await readFile(exportPath, 'utf8')).accessories).toEqual(beforeReload.accessories);
  await selectAccessory(page, 'a-platform');
  await applyName(page, 'Temporary name');
  await page.getByLabel('Open railway file', { exact: true }).setInputFiles(exportPath);
  await advance(page);
  await expectSign(page, 'named-platform', '京都 Kyoto');
  await expectSign(page, 'named-station', 'Central Station');
  expect((await saved(page)).accessories).toEqual(beforeReload.accessories);
  expect(errors).toEqual([]);
});

test('applying and resetting a station name keeps the selected Yamanote train moving', async ({ page }) => {
  await freeze(page);
  await seed(page, layout(true));
  // Selecting pieces already pauses trains; choose the piece before starting
  // so this regression specifically observes the metadata edit itself.
  await selectAccessory(page, 'a-platform');
  await page.getByRole('button', { name: 'Run train', exact: true }).click();
  await advance(page, 300);
  const before = await movingTrain(page);
  expect(before.running).toBe(true);
  expect(before.actualSpeed).toBe(20);
  await applyName(page, '大崎 Osaki');
  await expectSign(page, 'named-platform', '大崎 Osaki');
  const after = await movingTrain(page);
  expect(after.running).toBe(true);
  expect(after.actualSpeed).toBe(before.actualSpeed);
  expect(after.requestedSpeed).toBe(before.requestedSpeed);
  expect(distance(after)).toBeGreaterThan(distance(before));
  expect(distance(after) - distance(before)).toBeLessThan(10);
  await advance(page, 200);
  const continued = await movingTrain(page);
  expect(continued.running).toBe(true);
  expect(continued.actualSpeed).toBe(20);
  expect(distance(continued)).toBeGreaterThan(distance(after));
  expect(continued.cars.every(car => car.visible)).toBe(true);
  await resetButton(page).click();
  await advance(page);
  await expectSign(page, 'named-platform', '原宿 Harajuku');
  expect((await movingTrain(page)).running).toBe(true);
  expect((await movingTrain(page)).actualSpeed).toBe(20);
  await expect(page.getByRole('button', { name: 'Pause train', exact: true })).toBeVisible();
});

test('mobile name editing fits the screen and includes open and end platforms', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await freeze(page);
  await seed(page, layout());
  await selectAccessory(page, 'a-platform-open');
  await expect(nameInput(page)).toHaveAttribute('maxlength', '60');
  const longName = '新宿'.repeat(30);
  await nameInput(page).fill(longName);
  await nameInput(page).press('End');
  await nameInput(page).pressSequentially('余');
  await expect(nameInput(page)).toHaveValue(longName);
  await applyButton(page).click();
  await advance(page);
  await expectSign(page, 'named-open-platform', longName);
  await expectWithinWidth(page, nameInput(page));
  await expectWithinWidth(page, applyButton(page));
  await expectWithinWidth(page, resetButton(page));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.station-name-editor').screenshot({ path: info.outputPath('mobile-station-name-editor.png') });
  await selectAccessory(page, 'a-platform-end');
  await applyName(page, '高輪 Gateway');
  await expectSign(page, 'named-end-platform', '高輪 Gateway');
  await expectSign(page, 'named-open-platform', longName);
  await selectAccessory(page, 'a-catenary');
  await expect(nameInput(page)).toHaveCount(0);
  await expect(applyButton(page)).toHaveCount(0);
  await expect(resetButton(page)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
