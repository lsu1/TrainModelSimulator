import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { KATO_CATALOG } from '../src/catalog';
import { attachTrack, endpoints, pathsFor } from '../src/track';
import type { Track } from '../src/track';

// Software WebGL may compile several detailed catalog models per workflow.
test.setTimeout(60_000);

const STORAGE_KEY = 'little-railways-layout-v3';
const SAVED_DESIGNS_KEY = 'little-railways-saved-designs-v1';
const canvasName = '3D railway layout: rotate, zoom, select trains, and move Kato track pieces';
const straightButton = 'Add 248 mm straight';
const curveButton = 'Add 282 mm radius · 45° curve';
const scene = (page: Page) => page.getByRole('img', { name: canvasName });

async function openRailway(page: Page) {
  await page.goto('/');
  await expect(scene(page)).toHaveAttribute('data-ready', 'true');
}

async function chooseLayout(page: Page, name: string) {
  await page.getByRole('button', { name: 'Layouts', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: new RegExp(`^${name}`) }).click();
}

async function startFresh(page: Page) {
  await chooseLayout(page, 'A fresh adventure');
  await expect(page.getByText('0 tracks · 0 scenery pieces', { exact: true })).toBeVisible();
}

async function savedLayout(page: Page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY);
}

async function currentRailway(page: Page) {
  const railway = { ...await savedLayout(page) };
  delete railway.savedDesignId;
  return railway;
}

async function savedDesigns(page: Page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{"version":1,"designs":[]}'), SAVED_DESIGNS_KEY);
}

async function saveDesign(page: Page, name: string, action: 'Save layout' | 'Save changes' | 'Save as copy' = 'Save layout') {
  await page.getByRole('button', { name: 'Save layout', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save your railway', exact: true });
  await dialog.getByRole('textbox', { name: 'Layout name', exact: true }).fill(name);
  await dialog.getByRole('button', { name: action, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

async function openSavedDesign(page: Page, name: string) {
  await page.getByRole('button', { name: 'Layouts', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: `Open saved layout ${name}`, exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

async function freezeAnimationClock(page: Page) {
  const time = new Date('2026-01-01T00:00:00Z');
  await page.clock.install({ time });
  await page.clock.pauseAt(new Date(time.getTime() + 1000));
}

// Advance in bounded steps: animation caps long frame gaps at 100 ms.
// Collapsing intermediate frames keeps software WebGL checks affordable.
async function advanceAnimation(page: Page, milliseconds: number) {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 100) {
    await page.clock.fastForward(Math.min(100, milliseconds - elapsed));
  }
  await page.clock.fastForward(16);
}

async function trainPoint(page: Page) {
  return scene(page).evaluate(element => ({
    x: Number((element as HTMLCanvasElement).dataset.trainX),
    y: Number((element as HTMLCanvasElement).dataset.trainY),
    z: Number((element as HTMLCanvasElement).dataset.trainHeight),
  }));
}

async function pickPoint(page: Page, id: string) {
  const canvas = scene(page);
  await canvas.scrollIntoViewIfNeeded();
  let previous = '';
  let stableSince = 0;
  await expect.poll(async () => canvas.evaluate((element, pieceId) => {
    const points = JSON.parse((element as HTMLCanvasElement).dataset.pickPoints ?? '{}');
    return !!points[pieceId];
  }, id)).toBe(true);
  // Orbit damping and viewport fitting can update a published projection
  // shortly after a layout change. Pick only after those coordinates settle.
  await expect.poll(async () => {
    const projection = await canvas.getAttribute('data-pick-points');
    if (projection !== previous) { previous = projection ?? ''; stableSince = Date.now(); }
    return Date.now() - stableSince;
  }, { intervals: [100], timeout: 10_000 }).toBeGreaterThanOrEqual(350);
  return canvas.evaluate((element, pieceId) => {
    const point = JSON.parse((element as HTMLCanvasElement).dataset.pickPoints!)[pieceId];
    const bounds = element.getBoundingClientRect();
    return { x: bounds.x + point.x, y: bounds.y + point.y };
  }, id);
}

async function importData(page: Page, value: unknown, filename = 'railway.json') {
  await page.getByLabel('Open railway file').setInputFiles({
    name: filename, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)),
  });
}

async function moveMouse(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

async function canvasColors(canvas: Locator) {
  return canvas.evaluate(element => new Promise<number>(resolve => requestAnimationFrame(() => {
    const surface = element as HTMLCanvasElement;
    const gl = surface.getContext('webgl2') ?? surface.getContext('webgl');
    if (!gl) return resolve(0);
    const pixels = new Uint8Array(surface.width * surface.height * 4);
    gl.readPixels(0, 0, surface.width, surface.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const colors = new Set<string>();
    for (let index = 0; index < pixels.length; index += 4 * 37) {
      if (pixels[index + 3]) colors.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`);
    }
    resolve(colors.size);
  })));
}

test('Tokyo starter renders a real 3D railway and an eleven-car E235 without browser errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await openRailway(page);
  await expect(page.getByRole('heading', { name: 'Tokyo Railway', exact: true })).toBeVisible();
  await expect(page.getByText('20 tracks · 5 scenery pieces', { exact: true })).toBeVisible();
  await expect(page.getByText('Connected loop · ready to ride', { exact: true })).toBeVisible();
  await expect(page.getByText(`${KATO_CATALOG.length} catalog pieces to discover.`, { exact: true })).toBeVisible();
  await expect(scene(page)).toHaveAttribute('data-car-count', '11');
  expect(await canvasColors(scene(page))).toBeGreaterThan(32);
  expect(errors).toEqual([]);
});

test('orbit dragging and camera presets change the rendered viewpoint', async ({ page }) => {
  await openRailway(page);
  const canvas = scene(page);
  const initialProjection = await canvas.getAttribute('data-pick-points');
  const bounds = (await canvas.boundingBox())!;
  await moveMouse(page, { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
    { x: bounds.x + bounds.width / 2 + 95, y: bounds.y + bounds.height / 2 + 45 });
  await expect.poll(() => canvas.getAttribute('data-pick-points')).not.toBe(initialProjection);
  const orbitProjection = await canvas.getAttribute('data-pick-points');
  await page.getByRole('button', { name: 'Top view', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Top view', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => canvas.getAttribute('data-pick-points')).not.toBe(orbitProjection);
  const topProjection = await canvas.getAttribute('data-pick-points');
  await page.getByRole('button', { name: 'Train view', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Train view', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => canvas.getAttribute('data-pick-points')).not.toBe(topProjection);
  await page.getByRole('button', { name: 'Fit railway to view' }).click();
  await expect(page.getByRole('button', { name: '3D view', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('3D train moves at the selected speed, pauses, and reverses without jumping', async ({ page }) => {
  await freezeAnimationClock(page);
  await openRailway(page);
  const slider = page.getByRole('slider', { name: 'Train speed' });
  await slider.focus();
  await slider.press('Home');
  await expect(slider).toHaveValue('5');
  const initial = await trainPoint(page);
  await page.getByRole('button', { name: 'Run train', exact: true }).click();
  await advanceAnimation(page, 400);
  const slow = await trainPoint(page);
  expect(slow.x).toBeGreaterThan(initial.x);
  await slider.focus();
  await slider.press('End');
  await expect(slider).toHaveValue('90');
  // Compare equal steady-speed windows after the new per-train acceleration
  // ramp, rather than requiring an instantaneous velocity jump.
  await advanceAnimation(page, 800);
  const fastStart = await trainPoint(page);
  await expect.poll(async () => scene(page).evaluate(element => {
    const fleet = JSON.parse((element as HTMLCanvasElement).dataset.fleetPoses ?? '[]');
    return fleet.find((train: { id: string }) => train.id === (element as HTMLCanvasElement).dataset.selectedTrainId)?.actualSpeed;
  })).toBe(90);
  await advanceAnimation(page, 400);
  const fast = await trainPoint(page);
  expect(fast.x - fastStart.x).toBeGreaterThan((slow.x - initial.x) * 10);
  await page.getByRole('button', { name: 'Pause train', exact: true }).click();
  await advanceAnimation(page, 100);
  const paused = await trainPoint(page);
  await advanceAnimation(page, 300);
  expect(await trainPoint(page)).toEqual(paused);
  await page.getByRole('button', { name: 'Reverse train direction' }).click();
  await advanceAnimation(page, 100);
  expect(await trainPoint(page)).toEqual(paused);
  await page.getByRole('button', { name: 'Run train', exact: true }).click();
  await advanceAnimation(page, 200);
  expect((await trainPoint(page)).x).toBeLessThan(paused.x);
});

test('train formations rebuild in 3D and the chosen formation survives a reload', async ({ page }) => {
  await openRailway(page);
  const formation = page.getByRole('combobox', { name: 'Train car count', exact: true });
  await expect(formation.locator('option')).toHaveCount(9);
  for (const count of ['3', '4', '5', '6', '7', '8', '9', '10', '11']) {
    await formation.selectOption(count);
    await expect(scene(page)).toHaveAttribute('data-car-count', count);
    expect((await savedLayout(page)).carCount).toBe(Number(count));
  }
  await formation.selectOption('7');
  await page.reload();
  await expect(scene(page)).toHaveAttribute('data-ready', 'true');
  await expect(formation).toHaveValue('7');
  await expect(scene(page)).toHaveAttribute('data-car-count', '7');
});

test('catalog categories and product-number search expose referenced Kato pieces', async ({ page }) => {
  await openRailway(page);
  const categoryGroup = page.getByRole('group', { name: 'Catalog categories' });
  for (const name of ['Straights', 'Curves', 'Turnouts', 'Crossings', 'Double', 'Viaducts', 'Bridges', 'Scenery']) {
    const button = categoryGroup.getByRole('button', { name, exact: true });
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(await page.locator('.piece-grid').getByRole('button').count()).toBeGreaterThan(0);
  }
  const search = page.getByRole('searchbox', { name: 'Search Kato catalog' });
  await search.fill('20-220');
  await expect(page.locator('.piece-grid').getByRole('button')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Add #4 left turnout', exact: true })).toBeVisible();
  await search.fill('impossible railway piece');
  await expect(page.getByText('No pieces found. Try a radius, length, or product number.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear catalog search' }).click();
  await expect(search).toHaveValue('');
  await page.getByRole('button', { name: 'Catalog & model references', exact: true }).click();
  const links = page.getByRole('dialog').getByRole('link');
  await expect(links).toHaveCount(16);
  for (const link of await links.all()) expect(await link.getAttribute('href')).toMatch(/^https:\/\/(katousa\.com|www\.katomodels\.com|unitrack\.katomodels\.com)\//);
});

test('eight curves build a closed 3D loop, with removal and undo restoring the connection', async ({ page }) => {
  await openRailway(page);
  await startFresh(page);
  await expect(page.getByRole('button', { name: 'Run train', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Remove selected train', exact: true }).click();
  await page.getByRole('button', { name: 'Curves', exact: true }).click();
  await page.getByRole('button', { name: 'Bend left', exact: true }).click();
  for (let index = 0; index < 8; index++) await page.getByRole('button', { name: curveButton, exact: true }).click();
  await expect(page.getByText('8 tracks · 0 scenery pieces', { exact: true })).toBeVisible();
  await expect(page.getByText('Connected loop · ready to ride', { exact: true })).toBeVisible();
  expect((await savedLayout(page)).tracks.every((track: { bend: number }) => track.bend === -1)).toBe(true);
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByText('2 open connectors', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo last change' }).click();
  await expect(page.getByText('Connected loop · ready to ride', { exact: true })).toBeVisible();
  const saved = await savedLayout(page);
  await page.reload();
  await expect(page.getByText('Connected loop · ready to ride', { exact: true })).toBeVisible();
  expect(await savedLayout(page)).toEqual({
    ...saved,
    // Ground-level pieces can omit heights until the import parser normalizes them.
    tracks: saved.tracks.map((track: { elevation?: number; endElevation?: number }) => ({
      ...track, elevation: track.elevation ?? 0, endElevation: track.endElevation ?? track.elevation ?? 0,
    })),
  });
});

test('native catalog drag places a track, and pointer dragging moves it with undo', async ({ page }) => {
  await openRailway(page);
  await startFresh(page);
  await page.getByRole('button', { name: 'Remove selected train', exact: true }).click();
  await page.getByRole('button', { name: 'Top view', exact: true }).click();
  const canvas = scene(page);
  const bounds = (await canvas.boundingBox())!;
  await page.getByRole('button', { name: straightButton, exact: true }).dragTo(canvas, {
    targetPosition: { x: bounds.width * .55, y: bounds.height * .55 },
  });
  await expect(page.getByText('1 tracks · 0 scenery pieces', { exact: true })).toBeVisible();
  const original = (await savedLayout(page)).tracks[0];
  expect(original.x).not.toBe(-300);
  await page.getByRole('button', { name: 'Deselect piece' }).click();
  const point = await pickPoint(page, original.id);
  await page.mouse.click(point.x, point.y);
  await expect(page.getByLabel('Selected piece height')).toBeVisible();
  await page.getByRole('button', { name: 'Move pieces', exact: true }).click();
  const start = await pickPoint(page, original.id);
  await moveMouse(page, start, { x: start.x + 65, y: start.y + 35 });
  await expect.poll(async () => {
    const moved = (await savedLayout(page)).tracks[0];
    return Math.hypot(moved.x - original.x, moved.y - original.y);
  }).toBeGreaterThan(20);
  await page.keyboard.press('Meta+z');
  expect((await savedLayout(page)).tracks[0]).toEqual(original);
});

test('selected tracks rotate and change height with a rendered sloping train', async ({ page }) => {
  await openRailway(page);
  await startFresh(page);
  await page.getByRole('button', { name: 'Remove selected train', exact: true }).click();
  await page.getByRole('button', { name: straightButton, exact: true }).click();
  await page.getByLabel('Selected piece height').fill('80');
  await page.getByLabel('Selected track end height').fill('100');
  await expect(page.getByText('8.1% slope · steep for a physical train', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Rotate selected piece' }).click();
  const track = (await savedLayout(page)).tracks[0];
  expect(track.angle).toBeCloseTo(Math.PI / 4);
  expect(track.elevation).toBe(80);
  expect(track.endElevation).toBe(100);
  await expect(page.getByRole('link', { name: 'See this piece in the Kato catalog' })).toHaveAttribute('href', /katousa\.com/);
  // Restore the original partial-train placement only after the unoccupied
  // track has been edited. Parked stock must protect the track beneath it.
  await importData(page, { version: 2, name: 'A sloping railway', tracks: [track], accessories: [], carCount: 3 });
  await expect.poll(async () => (await trainPoint(page)).z).toBeGreaterThan(80);
  expect((await trainPoint(page)).z).toBeLessThan(100);
});

test('Sky Railway renders an elevated loop above its separate ground-level underpass', async ({ page }) => {
  await openRailway(page);
  await chooseLayout(page, 'Sky Railway');
  await expect(page.getByRole('heading', { name: 'Sky Railway', exact: true })).toBeVisible();
  await expect(page.getByText('Connected loop · ready to ride', { exact: true })).toBeVisible();
  const layout = await savedLayout(page);
  const elevated = layout.tracks.filter((track: { id: string }) => !track.id.startsWith('ground-'));
  const ground = layout.tracks.filter((track: { id: string }) => track.id.startsWith('ground-'));
  expect(elevated.length).toBeGreaterThan(10);
  expect(elevated.every((track: { elevation: number; endElevation: number }) => track.elevation === 60 && track.endElevation === 60)).toBe(true);
  expect(ground).toHaveLength(5);
  expect(ground.every((track: { elevation: number }) => track.elevation === 0)).toBe(true);
  const piers = layout.accessories.filter((piece: { kind: string }) => piece.kind === 'a-pier-tapered');
  expect(piers).toHaveLength(16);
  expect(piers.every((piece: { elevation: number }) => piece.elevation === 0)).toBe(true);
  await expect.poll(async () => (await trainPoint(page)).z).toBe(60);
  await expect(page.getByLabel('New piece height')).toHaveValue('60');
});

test('KATO plan02 opens in 3D with its numbered switches and retains its source across undo, saves, and imports', async ({ page }, testInfo) => {
  await openRailway(page);
  const previous = await savedLayout(page);
  await chooseLayout(page, 'KATO M1');
  await expect(page.getByRole('heading', { name: 'KATO M1 + V1 + V2', exact: true })).toBeVisible();
  await expect(page.getByText('51 tracks · 18 scenery pieces', { exact: true })).toBeVisible();
  await expect(page.getByText('Connected loop · ready to ride', { exact: true })).toBeVisible();
  await expect(scene(page)).toHaveAttribute('data-car-count', '3');
  await expect(page.getByRole('combobox', { name: 'Train car count', exact: true })).toHaveValue('3');
  await expect(page.locator('.layout-plan-info')).toContainText('four additional R315-45 curves');
  await expect(page.locator('.layout-plan-info')).toContainText('Pier heights are modeled');
  await expect(page.getByRole('link', { name: 'View KATO plan' })).toHaveAttribute('href',
    'https://www.katomodels.com/unitrackplan/plan/plan02-1a.pdf');
  await expect.poll(() => scene(page).evaluate(element =>
    JSON.parse((element as HTMLCanvasElement).dataset.errorPieceIds ?? '[]'))).toEqual([]);
  const preset = await savedLayout(page);
  expect(preset.sourcePlan).toBe('kato-plan02-1a');
  expect(preset.tracks).toHaveLength(51);
  expect(preset.accessories).toHaveLength(18);
  expect(preset.accessories.every((support: { elevation: number }) => support.elevation === 0)).toBe(true);
  await page.getByRole('button', { name: 'Undo last change' }).click();
  await expect(page.getByRole('heading', { name: previous.name, exact: true })).toBeVisible();
  expect(await savedLayout(page)).toEqual(previous);
  await expect(page.locator('.layout-plan-info')).toHaveCount(0);
  await chooseLayout(page, 'KATO M1');
  // The starter formation spans Switch 1. Clear it before deliberately
  // changing both routes; parked trains now protect their point blades.
  await page.getByRole('button', { name: 'Remove selected train', exact: true }).click();
  const desk = page.getByRole('region', { name: 'Turnout switch controls' });
  await expect(desk.getByRole('group')).toHaveCount(2);
  for (const number of [1, 2]) {
    await expect(desk.getByRole('group', { name: `Switch ${number}`, exact: true })).toBeVisible();
    await expect(desk.getByRole('button', { name: `Switch ${number} straight`, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await desk.getByRole('button', { name: `Switch ${number} branch`, exact: true }).click();
    await expect(desk.getByRole('button', { name: `Switch ${number} branch`, exact: true })).toHaveAttribute('aria-pressed', 'true');
  }
  const saved = await savedLayout(page);
  expect(saved.sourcePlan).toBe('kato-plan02-1a');
  expect(saved.tracks.filter((track: { switchNumber?: number }) => track.switchNumber)
    .map((track: { switchNumber: number; switchState: string }) => [track.switchNumber, track.switchState]))
    .toEqual([[1, 'branch'], [2, 'branch']]);
  await page.reload();
  await expect(scene(page)).toHaveAttribute('data-ready', 'true');
  expect(await savedLayout(page)).toEqual(saved);
  await expect(page.getByRole('link', { name: 'View KATO plan' })).toBeVisible();
  await expect(desk.getByRole('button', { name: 'Switch 2 branch', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save a layout file', exact: true }).click();
  const download = await downloadPromise;
  const exportPath = testInfo.outputPath('kato-plan02.json');
  await download.saveAs(exportPath);
  expect(JSON.parse(await readFile(exportPath, 'utf8'))).toEqual(saved);
  await startFresh(page);
  await page.getByRole('button', { name: 'Layouts', exact: true }).click();
  await page.getByLabel('Open railway file').setInputFiles(exportPath);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: saved.name, exact: true })).toBeVisible();
  expect(await savedLayout(page)).toEqual(saved);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.layout-plan-info')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('a selected turnout switches the running train onto its branch and persists the route', async ({ page }) => {
  await freezeAnimationClock(page);
  await openRailway(page);
  await startFresh(page);
  await page.getByRole('button', { name: straightButton, exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search Kato catalog' }).fill('20-220');
  await page.getByRole('button', { name: 'Add #4 left turnout', exact: true }).click();
  await page.getByRole('button', { name: 'Branch route', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Branch route', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const turnout = (await savedLayout(page)).tracks[1];
  expect(turnout.kind).toBe('t4l');
  expect(turnout.bend).toBe(-1);
  expect(turnout.switchState).toBe('branch');
  const slider = page.getByRole('slider', { name: 'Train speed' });
  await slider.focus();
  await slider.press('End');
  await page.getByRole('button', { name: 'Run train', exact: true }).click();
  await advanceAnimation(page, 1_500);
  await expect(page.getByRole('button', { name: 'Run train', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('End of the line!');
  expect((await trainPoint(page)).y).toBeLessThan(-.5);
  await page.reload();
  await expect(scene(page)).toHaveAttribute('data-ready', 'true');
  expect((await savedLayout(page)).tracks[1].switchState).toBe('branch');

  // A turnout can also be the first piece. Its chosen route must govern
  // the initial rendered train, rather than only trains entering later.
  await startFresh(page);
  await page.getByRole('button', { name: 'Remove selected train', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search Kato catalog' }).fill('20-220');
  await page.getByRole('button', { name: 'Add #4 left turnout', exact: true }).click();
  await page.getByRole('button', { name: 'Branch route', exact: true }).click();
  const branch = await savedLayout(page);
  await importData(page, { version: 2, name: 'Branch first', tracks: branch.tracks, accessories: [], carCount: 3 });
  await advanceAnimation(page, 100);
  expect((await trainPoint(page)).y).toBeLessThan(-.5);
});

test('version 3 saves export tracks, scenery, heights, and train formation and can be reopened', async ({ page }, testInfo) => {
  await openRailway(page);
  await startFresh(page);
  await page.getByRole('button', { name: 'Remove selected train', exact: true }).click();
  await page.getByRole('button', { name: straightButton, exact: true }).click();
  await page.getByLabel('Selected piece height').fill('80');
  await page.getByRole('searchbox', { name: 'Search Kato catalog' }).fill('23-150');
  await page.getByRole('button', { name: 'Add Modern DX island platform A · 248 mm', exact: true }).click();
  const built = await savedLayout(page);
  await importData(page, { version: 2, name: 'My Railway', tracks: built.tracks, accessories: built.accessories, carCount: 3 });
  await page.getByRole('combobox', { name: 'Train car count', exact: true }).selectOption('6');
  const saved = await savedLayout(page);
  expect(saved.version).toBe(3);
  expect(saved.tracks).toHaveLength(1);
  expect(saved.accessories).toHaveLength(1);
  expect(saved.carCount).toBe(6);
  await page.reload();
  expect(await savedLayout(page)).toEqual(saved);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save a layout file', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('my-railway.json');
  const exportPath = testInfo.outputPath('my-railway.json');
  await download.saveAs(exportPath);
  expect(JSON.parse(await readFile(exportPath, 'utf8'))).toEqual(saved);
  await startFresh(page);
  await page.getByRole('button', { name: 'Layouts', exact: true }).click();
  await page.getByLabel('Open railway file').setInputFiles(exportPath);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('1 tracks · 1 scenery pieces', { exact: true })).toBeVisible();
  expect(await savedLayout(page)).toEqual(saved);
});

test('earlier 2D browser saves migrate into 3D without losing their railway geometry', async ({ page }) => {
  const legacy = {
    version: 1, name: 'Our original railway',
    tracks: [{ id: 'old-straight', kind: 's248', x: -140, y: 35, angle: .4, bend: 1 }],
  };
  await page.addInitScript(value => localStorage.setItem('little-railways-layout-v1', JSON.stringify(value)), legacy);
  await openRailway(page);
  await expect(page.getByRole('heading', { name: legacy.name, exact: true })).toBeVisible();
  const migrated = await savedLayout(page);
  expect(migrated).toMatchObject({ ...legacy, version: 3, tracks: [{ ...legacy.tracks[0], elevation: 0, endElevation: 0 }], accessories: [], carCount: 11 });
  expect(migrated.trains).toHaveLength(1);
  expect(migrated.trains[0]).toMatchObject({ type: 'e235', carCount: 11 });
  await expect(scene(page)).toHaveAttribute('data-car-count', '11');
});

test('invalid 3D imports preserve the current railway and allow a later valid import', async ({ page }) => {
  await openRailway(page);
  const original = await savedLayout(page);
  await page.getByRole('button', { name: 'Layouts', exact: true }).click();
  await importData(page, { ...original, tracks: [{ ...original.tracks[0], elevation: -1 }] }, 'broken.json');
  await expect(page.getByRole('status')).toContainText('invalid track piece');
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await savedLayout(page)).toEqual(original);
  const imported = {
    version: 2, name: 'Dad and son railway', carCount: 3, accessories: [],
    tracks: [{ id: 'our-straight', kind: 's248', x: -100, y: 0, angle: 0, bend: 1, elevation: 40, endElevation: 40 }],
  };
  await importData(page, imported);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: imported.name, exact: true })).toBeVisible();
  expect(await savedLayout(page)).toMatchObject({ ...imported, version: 3 });
  await expect(scene(page)).toHaveAttribute('data-car-count', '3');
});

test('Mac shortcuts undo from focused buttons and ignore catalog typing', async ({ page }) => {
  await freezeAnimationClock(page);
  await openRailway(page);
  const search = page.getByRole('searchbox', { name: 'Search Kato catalog' });
  await search.focus();
  await page.keyboard.press('r');
  await page.keyboard.press('Space');
  await expect(search).toHaveValue('r ');
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Run train', exact: true })).toBeVisible();
  await search.fill('');
  await scene(page).focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Pause train', exact: true })).toBeVisible();
  await advanceAnimation(page, 200);
  await page.keyboard.press('Space');
  const beforeReverse = await trainPoint(page);
  await page.keyboard.press('r');
  await page.keyboard.press('Space');
  await advanceAnimation(page, 100);
  expect((await trainPoint(page)).x).toBeLessThan(beforeReverse.x);
  await page.keyboard.press('Space');
  await startFresh(page);
  await page.getByRole('button', { name: straightButton, exact: true }).click();
  await expect(page.getByRole('button', { name: straightButton, exact: true })).toBeFocused();
  await page.keyboard.press('Meta+z');
  await expect(page.getByText('0 tracks · 0 scenery pieces', { exact: true })).toBeVisible();
});

test('help traps and restores focus, and a small screen has no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openRailway(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const helpButton = page.getByRole('button', { name: 'How to play', exact: true });
  await helpButton.click();
  const dialog = page.getByRole('dialog', { name: 'A railway you can explore in 3D' });
  const closeButton = dialog.getByRole('button', { name: 'Close dialog', exact: true });
  const letsPlay = dialog.getByRole('button', { name: 'Let’s play', exact: true });
  await expect(closeButton).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(letsPlay).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(closeButton).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(helpButton).toBeFocused();
});

function fixtureTrack(id: string, x: number, y = 0, patch: Record<string, unknown> = {}) {
  return { id, kind: 's248', x, y, angle: 0, bend: 1, elevation: 0, endElevation: 0, ...patch };
}

function fixtureAccessory(id: string, kind: string, x: number, y: number) {
  return { id, kind, x, y, angle: 0, elevation: 0 };
}

function fixtureLayout(name: string, tracks: Record<string, unknown>[], accessories: Record<string, unknown>[] = []) {
  return { version: 2, name, tracks, accessories, carCount: 3 };
}

function savedIdeaFixture() {
  return {
    ...fixtureLayout('An edited KATO adventure', [
      fixtureTrack('idea-flat', -248),
      fixtureTrack('idea-slope', 0, 0, { kind: 'v248', endElevation: 20 }),
      fixtureTrack('idea-switch', 350, 180, { kind: 't6l', bend: -1, switchNumber: 4, switchState: 'branch' }),
    ], [fixtureAccessory('idea-platform', 'a-platform', 124, -66)]),
    sourcePlan: 'kato-plan02-1a',
    carCount: 5,
  };
}

test('named saved layouts keep independent designs through fresh starts, reloads, updates, copies, and deletion', async ({ page }) => {
  test.setTimeout(120_000);
  await seedLayout(page, savedIdeaFixture());
  await saveDesign(page, 'Our overpass');
  const overpass = await currentRailway(page);
  const firstId = (await savedLayout(page)).savedDesignId;
  expect(firstId).toBeTruthy();
  const secondIdea = {
    ...fixtureLayout('Another idea', [
      fixtureTrack('other-elevated', -124, 0, { elevation: 60, endElevation: 80 }),
      fixtureTrack('other-switch', 300, 160, { kind: 't4r', switchNumber: 2, switchState: 'straight' }),
    ], [fixtureAccessory('other-station', 'a-station-local', 0, -180)]),
    carCount: 8,
  };
  await importData(page, secondIdea);
  await saveDesign(page, 'Station idea');
  const station = await currentRailway(page);
  const secondId = (await savedLayout(page)).savedDesignId;
  expect(secondId).not.toBe(firstId);
  expect((await savedDesigns(page)).designs).toHaveLength(2);
  await startFresh(page);
  await page.reload();
  await expect(scene(page)).toHaveAttribute('data-ready', 'true');
  expect((await currentRailway(page)).tracks).toHaveLength(0);
  await openSavedDesign(page, 'Our overpass');
  expect(await currentRailway(page)).toEqual(overpass);
  await expect(scene(page)).toHaveAttribute('data-car-count', '5');
  await expect(page.getByRole('button', { name: 'Switch 4 branch', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.layout-plan-info')).toBeVisible();
  await page.reload();
  await expect(scene(page)).toHaveAttribute('data-ready', 'true');
  expect((await savedLayout(page)).savedDesignId).toBe(firstId);
  expect(await currentRailway(page)).toEqual(overpass);
  await page.getByRole('combobox', { name: 'Train car count', exact: true }).selectOption('7');
  await saveDesign(page, 'Our overpass on Sunday', 'Save changes');
  const revised = await currentRailway(page);
  expect(revised.carCount).toBe(7);
  expect((await savedLayout(page)).savedDesignId).toBe(firstId);
  const revisedLibrary = (await savedDesigns(page)).designs;
  expect(revisedLibrary).toHaveLength(2);
  expect(revisedLibrary.find((entry: { id: string }) => entry.id === firstId).layout).toEqual(revised);
  expect(revisedLibrary.find((entry: { id: string }) => entry.id === secondId).layout).toEqual(station);
  await openSavedDesign(page, 'Station idea');
  expect(await currentRailway(page)).toEqual(station);
  await expect(scene(page)).toHaveAttribute('data-car-count', '8');
  await expect(page.locator('.layout-plan-info')).toHaveCount(0);
  await saveDesign(page, 'Station at night', 'Save as copy');
  const fork = await currentRailway(page);
  const forkId = (await savedLayout(page)).savedDesignId;
  expect([firstId, secondId]).not.toContain(forkId);
  const copiedLibrary = (await savedDesigns(page)).designs;
  expect(copiedLibrary).toHaveLength(3);
  expect(copiedLibrary.find((entry: { id: string }) => entry.id === secondId).layout).toEqual(station);
  expect(copiedLibrary.find((entry: { id: string }) => entry.id === firstId).layout).toEqual(revised);
  await page.getByRole('button', { name: 'Layouts', exact: true }).click();
  const libraryDialog = page.getByRole('dialog');
  await libraryDialog.getByRole('button', { name: 'Delete saved layout Station at night', exact: true }).click();
  await libraryDialog.getByRole('button', { name: 'Keep layout', exact: true }).click();
  expect((await savedDesigns(page)).designs).toHaveLength(3);
  await libraryDialog.getByRole('button', { name: 'Delete saved layout Station at night', exact: true }).click();
  await libraryDialog.getByRole('button', { name: 'Confirm delete Station at night', exact: true }).click();
  await expect(libraryDialog.getByRole('button', { name: 'Open saved layout Station at night', exact: true })).toHaveCount(0);
  expect((await savedDesigns(page)).designs).toHaveLength(2);
  expect(await currentRailway(page), 'Deleting a saved snapshot keeps the design on the table').toEqual(fork);
  expect((await savedLayout(page)).savedDesignId).toBeUndefined();
  await page.keyboard.press('Escape');
  await saveDesign(page, 'Station at night again');
  expect((await savedDesigns(page)).designs).toHaveLength(3);
});

test('undo restores the saved design identity so Save changes updates the design that is actually open', async ({ page }) => {
  await seedLayout(page, fixtureLayout('First draft', [fixtureTrack('draft-a', -124)]));
  await saveDesign(page, 'Layout A');
  const aId = (await savedLayout(page)).savedDesignId;
  await startFresh(page);
  await page.getByRole('button', { name: 'Curves', exact: true }).click();
  await page.getByRole('button', { name: curveButton, exact: true }).click();
  await saveDesign(page, 'Layout B');
  const bId = (await savedLayout(page)).savedDesignId;
  const bSnapshot = (await savedDesigns(page)).designs.find((entry: { id: string }) => entry.id === bId);
  await openSavedDesign(page, 'Layout A');
  await openSavedDesign(page, 'Layout B');
  await page.getByRole('button', { name: 'Undo last change', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Layout A', exact: true })).toBeVisible();
  expect((await savedLayout(page)).savedDesignId).toBe(aId);
  await page.getByRole('combobox', { name: 'Train car count', exact: true }).selectOption('6');
  await saveDesign(page, 'Layout A revised', 'Save changes');
  const library = (await savedDesigns(page)).designs;
  expect(library).toHaveLength(2);
  expect(library.find((entry: { id: string }) => entry.id === aId).layout).toEqual(await currentRailway(page));
  expect(library.find((entry: { id: string }) => entry.id === bId)).toEqual(bSnapshot);
});

test('a file backup of a saved design reopens as an independent draft while its saved snapshot remains intact', async ({ page }, testInfo) => {
  await seedLayout(page, savedIdeaFixture());
  await saveDesign(page, 'Keep our bridge');
  const original = await currentRailway(page);
  const originalId = (await savedLayout(page)).savedDesignId;
  const originalEntry = (await savedDesigns(page)).designs[0];
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save a layout file', exact: true }).click();
  const download = await downloadPromise;
  const exportPath = testInfo.outputPath('saved-design-backup.json');
  await download.saveAs(exportPath);
  expect(JSON.parse(await readFile(exportPath, 'utf8'))).toEqual(original);
  await startFresh(page);
  await page.getByRole('button', { name: 'Layouts', exact: true }).click();
  await page.getByLabel('Open railway file').setInputFiles(exportPath);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await currentRailway(page)).toEqual(original);
  expect((await savedLayout(page)).savedDesignId).toBeUndefined();
  await saveDesign(page, 'Bridge backup copy');
  const library = (await savedDesigns(page)).designs;
  expect(library).toHaveLength(2);
  expect(library.find((entry: { id: string }) => entry.id === originalId)).toEqual(originalEntry);
  expect((await savedLayout(page)).savedDesignId).not.toBe(originalId);
});

test('a browser storage failure keeps named layouts intact and leaves failed saves open for a backup', async ({ page }) => {
  await seedLayout(page, fixtureLayout('Reliable draft', [fixtureTrack('quota-track', -124)]));
  await saveDesign(page, 'Protected design');
  const libraryBefore = await savedDesigns(page);
  await page.getByRole('combobox', { name: 'Train car count', exact: true }).selectOption('6');
  const unsavedChanges = await currentRailway(page);
  await page.evaluate(key => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (storageKey: string, value: string) {
      if (storageKey === key) throw new DOMException('Simulated full browser storage', 'QuotaExceededError');
      return original.call(this, storageKey, value);
    };
  }, SAVED_DESIGNS_KEY);
  await page.getByRole('button', { name: 'Save layout', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save your railway', exact: true });
  await dialog.getByRole('textbox', { name: 'Layout name', exact: true }).fill('An update that cannot be saved');
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toBeVisible();
  expect(await savedDesigns(page)).toEqual(libraryBefore);
  expect(await currentRailway(page)).toEqual(unsavedChanges);
  await dialog.getByRole('button', { name: 'Save as copy', exact: true }).click();
  expect(await savedDesigns(page)).toEqual(libraryBefore);
  expect(await currentRailway(page)).toEqual(unsavedChanges);
  await page.keyboard.press('Escape');
  await startFresh(page);
  const newDraft = await currentRailway(page);
  await page.getByRole('button', { name: 'Save layout', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Layout name', exact: true }).fill('A new unsaved idea');
  await dialog.getByRole('button', { name: 'Save layout', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toBeVisible();
  expect(await savedDesigns(page)).toEqual(libraryBefore);
  expect(await currentRailway(page)).toEqual(newDraft);
  expect((await savedLayout(page)).savedDesignId).toBeUndefined();
});

test('Save layout focuses the name, traps keyboard focus, and fits a small screen with long saved names', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedLayout(page, fixtureLayout('Our small screen railway', [fixtureTrack('small-track', -124)]));
  const saveButton = page.getByRole('button', { name: 'Save layout', exact: true });
  await saveButton.click();
  const dialog = page.getByRole('dialog', { name: 'Save your railway', exact: true });
  const name = dialog.getByRole('textbox', { name: 'Layout name', exact: true });
  await expect(name).toBeFocused();
  expect(await name.evaluate(element => {
    const input = element as HTMLInputElement;
    return [input.selectionStart, input.selectionEnd];
  })).toEqual([0, 'Our small screen railway'.length]);
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Close dialog', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Save layout', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close dialog', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(name).toBeFocused();
  const longName = 'Our elevated station and passing siding on a rainy Sunday';
  await name.fill(longName);
  await name.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(saveButton).toBeFocused();
  await page.getByRole('button', { name: 'Layouts', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your saved layouts', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: `Open saved layout ${longName}`, exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await saveButton.click();
  await expect(dialog.getByRole('button', { name: 'Save changes', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Save as copy', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

function curvedConsistFixture(carCount: 3 | 11, turnout: boolean) {
  const tracks: Track[] = [];
  let anchor = { position: { x: -992, y: 0 }, angle: 0 };
  const append = (kind: string, bend: 1 | -1 = 1, branch = false) => {
    const track = attachTrack(kind, bend, anchor, `curve-check-${tracks.length}`);
    if (branch) track.switchState = 'branch';
    tracks.push(track);
    anchor = endpoints(track)[branch ? 2 : 1];
  };
  for (let index = 0; index < 4; index += 1) append('s248');
  const approach = tracks.at(-1)!;
  if (turnout) {
    append('t4l', -1, true);
    for (let index = 0; index < 4; index += 1) append('c249', -1);
    append('s248');
    append('s248');
  } else {
    for (let index = 0; index < 4; index += 1) append('c216');
    for (let index = 0; index < 4; index += 1) append('s248');
    for (let index = 0; index < 4; index += 1) append('c216');
  }
  // Start beside the transition with the rest of the formation already on
  // connected rails. Save order does not determine physical connectivity.
  const ordered = [approach, ...tracks.filter(track => track !== approach)];
  return {
    ...fixtureLayout(turnout ? 'Curve after a turnout' : 'Long train on tight curves', ordered.map(track => ({ ...track }))),
    carCount,
  };
}

type RenderedPoint = { x: number; y: number; z: number };
type RenderedTurnoutPoints = {
  id: string;
  kind: string;
  state: 'straight' | 'branch';
  fraction: number;
  target: number;
  animating: boolean;
  pairs: {
    id: string;
    blades: { route: number; side: number; closed: boolean; tip: RenderedPoint; heel: RenderedPoint; stockTip: RenderedPoint; gap: number }[];
    tieBar: { first: RenderedPoint; second: RenderedPoint };
  }[];
};
type RenderedCar = {
  index: number;
  visible: boolean;
  center: RenderedPoint;
  frontBogie: RenderedPoint;
  rearBogie: RenderedPoint;
  frontEnd: RenderedPoint;
  rearEnd: RenderedPoint;
  frontGangway: RenderedPoint;
  rearGangway: RenderedPoint;
  quaternion: [number, number, number, number];
};
type RenderedCoupler = {
  index: number;
  visible: boolean;
  front: RenderedPoint;
  rear: RenderedPoint;
  frontGangway: RenderedPoint;
  rearGangway: RenderedPoint;
};

const pointGap = (a: RenderedPoint, b: RenderedPoint) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

async function renderedTurnoutPoints(page: Page) {
  return scene(page).evaluate(element =>
    JSON.parse((element as HTMLCanvasElement).dataset.turnoutPoints ?? '[]') as RenderedTurnoutPoints[]);
}

function expectPointBladeEndpoint(points: RenderedTurnoutPoints[], branch: boolean) {
  for (const turnout of points) {
    expect(turnout.state).toBe(branch ? 'branch' : 'straight');
    expect(turnout.fraction).toBe(branch ? 1 : 0);
    expect(turnout.target).toBe(branch ? 1 : 0);
    expect(turnout.animating).toBe(false);
    expect(turnout.pairs).toHaveLength(turnout.kind === 'scissors' ? 4 : 1);
    for (const pair of turnout.pairs) {
      expect(pair.blades).toHaveLength(2);
      for (const blade of pair.blades) {
        const branchBlade = turnout.kind === 'scissors' ? blade.route >= 2 : blade.route === 1;
        const closed = branchBlade === branch;
        expect(blade.closed, `${turnout.kind} pair ${pair.id} closes the selected route`).toBe(closed);
        // Diagnostics give rail center points. Subtract the stock rail's
        // 0.49 mm half-head and the tapered tip's 0.055 mm half-head to
        // measure the actual air gap between their facing surfaces.
        expect(blade.gap, `${turnout.kind} blade gap matches its rendered tip`).toBeCloseTo(pointGap(blade.tip, blade.stockTip) - .545, 2);
        if (closed) expect(blade.gap).toBeLessThan(.06);
        else expect(blade.gap).toBeGreaterThan(1.5);
      }
    }
  }
}

test('all rendered turnout point blades and scissors pairs move gradually and return to their original rail positions', async ({ page }) => {
  test.setTimeout(90_000);
  await freezeAnimationClock(page);
  const kinds = ['t4l', 't4r', 't6l', 't6r', 'scissors'];
  await seedLayout(page, fixtureLayout('Point blade detail test', [
    fixtureTrack('safe-approach', -750, -300),
    ...kinds.map((kind, index) => fixtureTrack(`points-${kind}`, index % 2 === 0 ? -248 : 220,
      Math.floor(index / 2) * 240, { kind, bend: kind.endsWith('l') ? -1 : 1, switchNumber: index + 1 })),
  ]));
  await advanceAnimation(page, 100);
  const initial = await renderedTurnoutPoints(page);
  expect(initial).toHaveLength(5);
  expectPointBladeEndpoint(initial, false);
  const desk = page.getByRole('region', { name: 'Turnout switch controls' });
  for (let number = 1; number <= 5; number += 1) {
    await desk.getByRole('button', { name: `Switch ${number} branch`, exact: true }).click();
  }
  await advanceAnimation(page, 80);
  const intermediate = await renderedTurnoutPoints(page);
  for (const [index, turnout] of intermediate.entries()) {
    expect(turnout.target).toBe(1);
    expect(turnout.animating).toBe(true);
    expect(turnout.fraction).toBeGreaterThan(0);
    expect(turnout.fraction).toBeLessThan(1);
    for (const [pairIndex, pair] of turnout.pairs.entries()) {
      for (const [bladeIndex, blade] of pair.blades.entries()) {
        expect(pointGap(blade.tip, initial[index].pairs[pairIndex].blades[bladeIndex].tip), 'Actual blade mesh has moved before animation finishes').toBeGreaterThan(.05);
      }
    }
  }
  await advanceAnimation(page, 400);
  const branched = await renderedTurnoutPoints(page);
  expectPointBladeEndpoint(branched, true);
  for (const [index, turnout] of branched.entries()) {
    for (const [pairIndex, pair] of turnout.pairs.entries()) {
      const originalPair = initial[index].pairs[pairIndex];
      for (const [bladeIndex, blade] of pair.blades.entries()) {
        const original = originalPair.blades[bladeIndex];
        expect(pointGap(blade.tip, original.tip), 'The blade tip visibly throws to the other route').toBeGreaterThan(1.5);
        expect(pointGap(blade.tip, original.tip)).toBeGreaterThan(pointGap(intermediate[index].pairs[pairIndex].blades[bladeIndex].tip, original.tip));
        expect(pointGap(blade.heel, original.heel), 'The point blade remains attached at its heel').toBeLessThan(.05);
        expect(pointGap(blade.stockTip, original.stockTip), 'The stock rail stays fixed').toBeLessThan(.005);
      }
      expect(pointGap(pair.tieBar.first, originalPair.tieBar.first), 'Each point-pair tie bar also moves').toBeGreaterThan(.1);
    }
  }
  const left = branched.findIndex(points => points.kind === 't4l');
  const right = branched.findIndex(points => points.kind === 't4r');
  const leftThrow = branched[left].pairs[0].blades[0].tip.y - initial[left].pairs[0].blades[0].tip.y;
  const rightThrow = branched[right].pairs[0].blades[0].tip.y - initial[right].pairs[0].blades[0].tip.y;
  expect(Math.sign(leftThrow), 'Left and right turnout throws are mirrored').toBe(-Math.sign(rightThrow));
  for (let number = 1; number <= 5; number += 1) {
    await desk.getByRole('button', { name: `Switch ${number} straight`, exact: true }).click();
  }
  await advanceAnimation(page, 80);
  for (const turnout of await renderedTurnoutPoints(page)) {
    expect(turnout.target).toBe(0);
    expect(turnout.animating).toBe(true);
    expect(turnout.fraction).toBeGreaterThan(0);
    expect(turnout.fraction).toBeLessThan(1);
  }
  await advanceAnimation(page, 400);
  const returned = await renderedTurnoutPoints(page);
  expectPointBladeEndpoint(returned, false);
  for (const [index, turnout] of returned.entries()) {
    for (const [pairIndex, pair] of turnout.pairs.entries()) {
      for (const [bladeIndex, blade] of pair.blades.entries()) {
        expect(pointGap(blade.tip, initial[index].pairs[pairIndex].blades[bladeIndex].tip), 'A reverse throw returns the actual mesh to its original position').toBeLessThan(.005);
      }
    }
  }
  // A second click while the points are still moving must start from the
  // visible position, without replacing the mesh or snapping to an endpoint.
  await desk.getByRole('button', { name: 'Switch 1 branch', exact: true }).click();
  await advanceAnimation(page, 80);
  const midThrow = (await renderedTurnoutPoints(page))[0];
  expect(midThrow.fraction).toBeGreaterThan(0);
  expect(midThrow.fraction).toBeLessThan(1);
  await desk.getByRole('button', { name: 'Switch 1 straight', exact: true }).click();
  await advanceAnimation(page, 0);
  const changedMind = (await renderedTurnoutPoints(page))[0];
  expect(changedMind.target).toBe(0);
  expect(changedMind.fraction).toBeGreaterThan(0);
  expect(changedMind.fraction).toBeLessThanOrEqual(midThrow.fraction);
  for (const [index, blade] of changedMind.pairs[0].blades.entries()) {
    expect(pointGap(blade.tip, midThrow.pairs[0].blades[index].tip), 'Rapid reversal continues from the last rendered pose').toBeLessThan(.05);
  }
  await advanceAnimation(page, 400);
  expectPointBladeEndpoint(await renderedTurnoutPoints(page), false);
});

async function renderedConsist(page: Page) {
  return scene(page).evaluate(element => {
    const data = (element as HTMLCanvasElement).dataset;
    return {
      cars: JSON.parse(data.carPoses ?? '[]') as RenderedCar[],
      couplers: JSON.parse(data.couplers ?? '[]') as RenderedCoupler[],
    };
  });
}

function selectedRailSamples(layout: ReturnType<typeof curvedConsistFixture>) {
  return (layout.tracks as unknown as Track[]).flatMap(track => pathsFor(track)
    .filter(path => !track.kind.startsWith('t') || path.route === (track.switchState === 'branch' ? 1 : 0))
    .flatMap(path => {
      const steps = Math.ceil(path.length);
      return Array.from({ length: steps + 1 }, (_, index) => {
        const point = path.pointAt(path.length * index / steps);
        return { ...point, z: point.z + 7.35 };
      });
    }));
}

function expectConnectedConsist(
  rendered: Awaited<ReturnType<typeof renderedConsist>>,
  count: number,
  rails: ReturnType<typeof selectedRailSamples>,
) {
  expect(rendered.cars).toHaveLength(count);
  expect(rendered.couplers).toHaveLength(count - 1);
  for (const car of rendered.cars) {
    expect(car.visible, `Car ${car.index} remains on the railway`).toBe(true);
    expect(pointGap(car.frontBogie, car.rearBogie), 'Rigid bogie wheelbase').toBeCloseTo(87.4, 1);
    expect(pointGap(car.frontEnd, car.rearEnd), 'Rigid car body length').toBeCloseTo(133.3, 1);
    expect(pointGap({
      x: (car.frontEnd.x - car.rearEnd.x) * 87.4 / 133.3,
      y: (car.frontEnd.y - car.rearEnd.y) * 87.4 / 133.3,
      z: (car.frontEnd.z - car.rearEnd.z) * 87.4 / 133.3,
    }, {
      x: car.frontBogie.x - car.rearBogie.x,
      y: car.frontBogie.y - car.rearBogie.y,
      z: car.frontBogie.z - car.rearBogie.z,
    }), 'Body points along the chord between its bogies').toBeLessThan(.05);
    for (const bogie of [car.frontBogie, car.rearBogie]) {
      // Samples are at most 1 mm apart, so a correctly rendered bogie lies
      // within 0.5 mm of one, including at joins and the selected branch.
      expect(Math.min(...rails.map(point => pointGap(point, bogie))), 'Bogie follows the selected rails').toBeLessThan(.55);
    }
    const midpoint = {
      x: (car.frontBogie.x + car.rearBogie.x) / 2,
      y: (car.frontBogie.y + car.rearBogie.y) / 2,
      z: (car.frontBogie.z + car.rearBogie.z) / 2,
    };
    expect(pointGap(car.center, midpoint), 'Body sits between its bogies').toBeLessThan(.05);
  }
  for (const coupling of rendered.couplers) {
    expect(coupling.visible).toBe(true);
    const leading = rendered.cars[coupling.index], following = rendered.cars[coupling.index + 1];
    expect(pointGap(coupling.front, { ...leading.rearBogie, z: leading.rearBogie.z + 3.45 }), 'Drawbar meets the leading bogie pin').toBeLessThan(.05);
    expect(pointGap(coupling.rear, { ...following.frontBogie, z: following.frontBogie.z + 3.45 }), 'Drawbar meets the following bogie pin').toBeLessThan(.05);
    expect(pointGap(coupling.front, coupling.rear), 'Drawbar length remains fixed').toBeCloseTo(50.1, 1);
    expect(pointGap(coupling.frontGangway, leading.rearGangway), 'Bellows meets the leading body').toBeLessThan(.05);
    expect(pointGap(coupling.rearGangway, following.frontGangway), 'Bellows meets the following body').toBeLessThan(.05);
    expect(pointGap(leading.rearEnd, following.frontEnd), 'Cars retain a short connected gap').toBeLessThan(12);
  }
}

test('KATO plan02 renders a connected three-car train climbing onto its red bridge and reversing smoothly', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await freezeAnimationClock(page);
  await openRailway(page);
  await chooseLayout(page, 'KATO M1');
  const layout = await savedLayout(page);
  // The complete routes are exercised in the geometry suite. Retain this
  // exact railway, but start near its summit to check the rendered ascent
  // and bridge without spending a full software-WebGL lap on approach.
  const start = layout.tracks.find((track: Track) => track.id === 'kato-plan02-main-24');
  layout.tracks = [start, ...layout.tracks.filter((track: Track) => track !== start)];
  // A version-3 file restores exact train positions; use the legacy format
  // intentionally to stage its one train at the reordered summit approach.
  layout.version = 2;
  delete layout.trains;
  delete layout.selectedTrainId;
  await importData(page, layout);
  await advanceAnimation(page, 100);
  const rails = selectedRailSamples(layout);
  expectConnectedConsist(await renderedConsist(page), 3, rails);
  const initial = await trainPoint(page);
  expect(initial.z).toBeGreaterThan(55);
  expect(initial.z).toBeLessThan(60);
  const ascending = (await renderedConsist(page)).cars[0];
  expect(ascending.frontBogie.z).toBeGreaterThan(ascending.rearBogie.z);
  await page.getByRole('slider', { name: 'Train speed' }).focus();
  await page.keyboard.press('End');
  await page.getByRole('button', { name: 'Run train', exact: true }).click();
  let previous = (await renderedConsist(page)).cars;
  // Four seconds at the E235's 90 km/h service cap reaches the bridge.
  for (let step = 0; step < 16; step += 1) {
    await advanceAnimation(page, 250);
    const rendered = await renderedConsist(page);
    expectConnectedConsist(rendered, 3, rails);
    for (const car of rendered.cars) {
      expect(pointGap(car.center, previous[car.index].center), 'Car climbs without jumping').toBeLessThan(75);
    }
    previous = rendered.cars;
  }
  await expect(page.getByRole('button', { name: 'Pause train', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pause train', exact: true }).click();
  await advanceAnimation(page, 100);
  const paused = await renderedConsist(page);
  expect((await trainPoint(page)).z).toBe(60);
  const bridge = layout.tracks.find((track: Track) => track.kind === 'b248-red') as Track;
  const bridgePath = pathsFor(bridge)[0];
  const bridgeStart = bridgePath.pointAt(0), bridgeEnd = bridgePath.pointAt(bridgePath.length);
  const dx = bridgeEnd.x - bridgeStart.x, dy = bridgeEnd.y - bridgeStart.y;
  const lead = paused.cars[0].center;
  const along = ((lead.x - bridgeStart.x) * dx + (lead.y - bridgeStart.y) * dy) / (dx * dx + dy * dy);
  expect(along, 'The leading car is inside the red bridge span').toBeGreaterThan(0);
  expect(along).toBeLessThan(1);
  expect(Math.hypot(lead.x - bridgeStart.x - along * dx, lead.y - bridgeStart.y - along * dy)).toBeLessThan(.05);
  const screenshotPath = testInfo.outputPath('kato-plan02-red-bridge.png');
  await scene(page).screenshot({ path: screenshotPath });
  await testInfo.attach('kato-plan02-red-bridge', { path: screenshotPath, contentType: 'image/png' });
  await page.getByRole('button', { name: 'Reverse train direction' }).click();
  await advanceAnimation(page, 100);
  expect(await renderedConsist(page), 'Reversal preserves every car and coupling').toEqual(paused);
  await page.getByRole('button', { name: 'Run train', exact: true }).click();
  await advanceAnimation(page, 250);
  const reversed = await renderedConsist(page);
  expectConnectedConsist(reversed, 3, rails);
  const before = paused.cars[0], after = reversed.cars[0];
  expect(pointGap(before.center, after.center)).toBeGreaterThan(5);
  expect(pointGap(before.center, after.center)).toBeLessThan(75);
  expect((after.center.x - before.center.x) * (before.frontEnd.x - before.rearEnd.x)
    + (after.center.y - before.center.y) * (before.frontEnd.y - before.rearEnd.y)).toBeLessThan(0);
  expect(errors).toEqual([]);
});

for (const [count, turnout] of [[3, true], [11, false]] as const) {
  test(`${count} rendered cars stay connected through ${turnout ? 'a turnout and curve' : 'tight curves'} and reverse smoothly`, async ({ page }, testInfo) => {
    const layout = curvedConsistFixture(count, turnout);
    const rails = selectedRailSamples(layout);
    await freezeAnimationClock(page);
    await seedLayout(page, layout);
    await expect(scene(page)).toHaveAttribute('data-car-count', String(count));
    expectConnectedConsist(await renderedConsist(page), count, rails);
    await page.getByRole('slider', { name: 'Train speed' }).focus();
    await page.keyboard.press('End');
    await page.getByRole('button', { name: 'Run train', exact: true }).click();
    let previous = (await renderedConsist(page)).cars;
    for (let step = 0; step < 8; step += 1) {
      await advanceAnimation(page, 250);
      const rendered = await renderedConsist(page);
      expectConnectedConsist(rendered, count, rails);
      for (const car of rendered.cars) {
        expect(pointGap(car.center, previous[car.index].center), 'Car advances without jumping').toBeLessThan(75);
        const dot = Math.abs(car.quaternion.reduce((sum, value, index) => sum + value * previous[car.index].quaternion[index], 0));
        expect(dot, 'Car heading changes smoothly through the join').toBeGreaterThan(Math.cos(Math.PI / 6));
      }
      previous = rendered.cars;
    }
    await page.getByRole('button', { name: 'Pause train', exact: true }).click();
    await advanceAnimation(page, 100);
    const paused = await renderedConsist(page);
    const headings = paused.cars.map(car => Math.atan2(car.frontEnd.y - car.rearEnd.y, car.frontEnd.x - car.rearEnd.x));
    expect(Math.max(...headings) - Math.min(...headings), 'The formation actually spans a bend').toBeGreaterThan(.15);
    if (turnout) expect(paused.cars[0].frontBogie.y).toBeLessThan(-.5);
    const perspectivePath = testInfo.outputPath(`${count}-cars-at-curve-perspective.png`);
    await scene(page).screenshot({ path: perspectivePath });
    await testInfo.attach(`${count}-cars-at-curve-perspective`, { path: perspectivePath, contentType: 'image/png' });
    await page.getByRole('button', { name: 'Top view', exact: true }).click();
    await advanceAnimation(page, 100);
    const topPath = testInfo.outputPath(`${count}-cars-at-curve-top.png`);
    await scene(page).screenshot({ path: topPath });
    await testInfo.attach(`${count}-cars-at-curve-top`, { path: topPath, contentType: 'image/png' });
    await page.getByRole('button', { name: 'Reverse train direction' }).click();
    await advanceAnimation(page, 100);
    expect(await renderedConsist(page), 'Reversal keeps every rendered car and connector in place').toEqual(paused);
    await page.getByRole('button', { name: 'Run train', exact: true }).click();
    await advanceAnimation(page, 250);
    const reversed = await renderedConsist(page);
    expectConnectedConsist(reversed, count, rails);
    const before = paused.cars[0], after = reversed.cars[0];
    expect(pointGap(before.center, after.center)).toBeGreaterThan(5);
    expect(pointGap(before.center, after.center)).toBeLessThan(75);
    const alongBody = (after.center.x - before.center.x) * (before.frontEnd.x - before.rearEnd.x)
      + (after.center.y - before.center.y) * (before.frontEnd.y - before.rearEnd.y);
    expect(alongBody, 'The same formation moves backwards').toBeLessThan(0);
  });
}

async function seedLayout(page: Page, layout: ReturnType<typeof fixtureLayout>) {
  await page.addInitScript(value => {
    if (!localStorage.getItem('little-railways-layout-v3') && !localStorage.getItem('little-railways-layout-v2')) {
      localStorage.setItem('little-railways-layout-v2', JSON.stringify(value));
    }
  }, layout);
  await openRailway(page);
}

async function reviewLayout(page: Page) {
  await page.getByRole('button', { name: 'Check before shopping', exact: true }).click();
  return page.getByRole('dialog', { name: 'Check your physical layout', exact: true });
}

test('numbered switches operate live without resetting a clear train and reject occupied changes', async ({ page }) => {
  await freezeAnimationClock(page);
  await seedLayout(page, fixtureLayout('Switch desk test', [
    fixtureTrack('approach', 0),
    fixtureTrack('switch-near', 248, 0, { kind: 't4l', bend: -1, switchNumber: 1 }),
    fixtureTrack('switch-away', 900, 220, { kind: 't4r', switchNumber: 7 }),
  ]));
  const desk = page.getByRole('region', { name: 'Turnout switch controls' });
  await expect(desk.getByRole('group', { name: 'Switch 1', exact: true })).toBeVisible();
  await expect(desk.getByRole('group', { name: 'Switch 7', exact: true })).toBeVisible();
  await page.getByRole('slider', { name: 'Train speed' }).focus();
  await page.keyboard.press('End');
  await page.getByRole('button', { name: 'Run train', exact: true }).click();
  await advanceAnimation(page, 100);
  const beforeSwitch = await trainPoint(page);
  await desk.getByRole('button', { name: 'Switch 7 branch', exact: true }).click();
  await advanceAnimation(page, 0);
  const afterSwitch = await trainPoint(page);
  expect(afterSwitch.x).toBeGreaterThanOrEqual(beforeSwitch.x);
  expect(afterSwitch.x - beforeSwitch.x).toBeLessThanOrEqual(7);
  expect(afterSwitch.y).toBe(beforeSwitch.y);
  expect(afterSwitch.z).toBe(beforeSwitch.z);
  await expect(page.getByRole('button', { name: 'Pause train', exact: true })).toBeVisible();
  await expect(desk.getByRole('button', { name: 'Switch 7 branch', exact: true })).toHaveAttribute('aria-pressed', 'true');
  // Wait for the actual train cursor to enter the points, rather
  // than making occupancy depend on the acceleration ramp's timing.
  await expect.poll(async () => {
    await advanceAnimation(page, 100);
    return scene(page).evaluate(element => {
      const fleet = JSON.parse((element as HTMLCanvasElement).dataset.fleetPoses ?? '[]');
      const selected = fleet.find((train: { id: string }) => train.id === (element as HTMLCanvasElement).dataset.selectedTrainId);
      return selected?.position?.trackId === 'switch-near' && selected.position.distance >= 35;
    });
  }, { timeout: 10_000, intervals: [100] }).toBe(true);
  expect((await trainPoint(page)).x).toBeGreaterThan(beforeSwitch.x);
  const occupiedPoints = (await renderedTurnoutPoints(page)).find(points => points.id === 'switch-near');
  await desk.getByRole('button', { name: 'Switch 1 branch', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Switch 1 is occupied');
  await expect(desk.getByRole('button', { name: 'Switch 1 straight', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Pause train', exact: true })).toBeVisible();
  await advanceAnimation(page, 0);
  expect((await renderedTurnoutPoints(page)).find(points => points.id === 'switch-near'), 'A rejected occupied-switch command does not move its point blades').toEqual(occupiedPoints);
  await page.getByRole('button', { name: 'Pause train', exact: true }).click();
  await desk.getByRole('button', { name: 'Switch 1 branch', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Switch 1 is occupied');
  await expect(desk.getByRole('button', { name: 'Switch 1 straight', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await advanceAnimation(page, 200);
  const badges = await scene(page).evaluate(element => JSON.parse((element as HTMLCanvasElement).dataset.switchNumbers!));
  expect(badges).toEqual([
    { id: 'switch-near', number: 1, state: 'straight' },
    { id: 'switch-away', number: 7, state: 'branch' },
  ]);
  const saved = await savedLayout(page);
  await page.reload();
  await expect(scene(page)).toHaveAttribute('data-ready', 'true');
  expect(await savedLayout(page)).toEqual(saved);
  await expect(desk.getByRole('button', { name: 'Switch 7 branch', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('guided ramp uses real S248 pieces, a grounded catalog pier, and a reviewable CSV', async ({ page }, testInfo) => {
  await seedLayout(page, fixtureLayout('Ramp shopping test', []));
  const builder = page.getByRole('region', { name: 'Ramp builder' });
  await expect(builder.getByRole('combobox', { name: 'Ramp target height' })).toHaveValue('60');
  await expect(builder.getByRole('combobox', { name: 'Ramp maximum grade' })).toHaveValue('3');
  await expect(builder).toContainText('9 × S248');
  await expect(builder).toContainText('support heights still need physical verification');
  await builder.getByRole('button', { name: 'Build ramp', exact: true }).click();
  const layout = await savedLayout(page);
  expect(layout.tracks).toHaveLength(9);
  expect(layout.tracks.every((track: { kind: string }) => track.kind === 's248')).toBe(true);
  expect(layout.tracks[0].elevation).toBe(0);
  expect(layout.tracks.at(-1).endElevation).toBe(60);
  for (const track of layout.tracks) {
    const rise = track.endElevation - track.elevation;
    expect(rise).toBeGreaterThan(0);
    expect(rise / Math.sqrt(248 ** 2 - rise ** 2) * 100).toBeLessThanOrEqual(3);
  }
  expect(layout.accessories).toHaveLength(1);
  expect(layout.accessories[0]).toMatchObject({ kind: 'a-pier-tapered', elevation: 0 });
  const report = await reviewLayout(page);
  await expect(report.getByText('Raised track ends need verified supports', { exact: true }).first()).toBeVisible();
  await expect(report.getByRole('row').filter({ hasText: '20-000' }).getByRole('cell').nth(2)).toHaveText('9');
  await expect(report.getByRole('row').filter({ hasText: '23-069' }).getByRole('cell').nth(2)).toHaveText('1');
  const downloadPromise = page.waitForEvent('download');
  await report.getByRole('button', { name: 'Save shopping report', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('kato-layout-shopping-review.csv');
  const exportPath = testInfo.outputPath('shopping-review.csv');
  await download.saveAs(exportPath);
  const csv = await readFile(exportPath, 'utf8');
  expect(csv.split('\r\n').find(row => row.startsWith('"20-000",'))).toMatch(/^"20-000","[^"]*","9",/);
  expect(csv.split('\r\n').find(row => row.startsWith('"23-069",'))).toMatch(/^"23-069","[^"]*","1",/);
  expect(csv).toContain('Individual placed pieces, not retail packs');
  expect(csv).toContain('Raised track ends need verified supports');
  expect(csv).toContain('E235 minimum radius and maximum grade remain unconfirmed');
});

test('matching piers support a sixty-millimeter track without floating or duplicate pieces', async ({ page }) => {
  await seedLayout(page, fixtureLayout('Supported track', []));
  await page.getByRole('button', { name: 'Remove selected train', exact: true }).click();
  await page.getByRole('button', { name: straightButton, exact: true }).click();
  await page.getByLabel('Selected piece height').fill('60');
  await page.getByRole('button', { name: 'Add matching piers', exact: true }).click();
  const supported = await savedLayout(page);
  expect(supported.accessories).toHaveLength(2);
  expect(supported.accessories.every((piece: { kind: string; elevation: number }) => piece.kind === 'a-pier-tapered' && piece.elevation === 0)).toBe(true);
  await page.getByRole('button', { name: 'Add matching piers', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('No additional matching catalog piers');
  expect((await savedLayout(page)).accessories).toHaveLength(2);
  const report = await reviewLayout(page);
  await expect(report.getByText('Raised track ends need verified supports', { exact: true })).toHaveCount(0);
  await expect(report.getByRole('row').filter({ hasText: '23-069' }).getByRole('cell').nth(2)).toHaveText('2');
});

test('moving a platform into the train corridor is rejected and its rendered position rolls back', async ({ page }) => {
  await seedLayout(page, fixtureLayout('Platform clearance', [fixtureTrack('rail', -124)], [
    fixtureAccessory('platform', 'a-platform', 0, 90),
  ]));
  await page.getByRole('button', { name: 'Top view', exact: true }).click();
  await page.getByRole('button', { name: 'Move pieces', exact: true }).click();
  const original = (await savedLayout(page)).accessories[0];
  const from = await pickPoint(page, 'platform');
  const to = await pickPoint(page, 'rail');
  await moveMouse(page, from, to);
  await expect(page.getByRole('alert')).toContainText('Placement blocked:');
  expect((await savedLayout(page)).accessories[0]).toEqual(original);
  const rolledBack = await pickPoint(page, 'platform');
  expect(Math.hypot(rolledBack.x - from.x, rolledBack.y - from.y)).toBeLessThan(3);
  await expect(page.getByRole('button', { name: 'Undo last change' })).toBeDisabled();
});

test('a centered catenary drop is allowed but moving its post onto the rails is rejected', async ({ page }) => {
  await seedLayout(page, fixtureLayout('Catenary clearance', [fixtureTrack('rail', -124)], [
    fixtureAccessory('reference-gantry', 'a-catenary', 0, 100),
  ]));
  await page.getByRole('button', { name: 'Top view', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search Kato catalog' }).fill('23-059-1');
  const target = await pickPoint(page, 'rail');
  const bounds = (await scene(page).boundingBox())!;
  await page.getByRole('button', { name: 'Add Single-track catenary pole', exact: true }).dragTo(scene(page), {
    targetPosition: { x: target.x - bounds.x, y: target.y - bounds.y },
  });
  await expect(page.getByText('1 tracks · 2 scenery pieces', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  const added = (await savedLayout(page)).accessories.find((piece: { id: string }) => piece.id !== 'reference-gantry');
  expect(Math.abs(added.y)).toBeLessThan(2);
  await page.getByRole('button', { name: 'Move pieces', exact: true }).click();
  const center = await pickPoint(page, added.id);
  const reference = await pickPoint(page, 'reference-gantry');
  const shift = { x: (reference.x - center.x) * 17 / 100, y: (reference.y - center.y) * 17 / 100 };
  const post = { x: center.x + shift.x, y: center.y + shift.y };
  await moveMouse(page, post, { x: post.x + shift.x, y: post.y + shift.y });
  await expect(page.getByRole('alert')).toContainText('catenary post is in the train');
  expect((await savedLayout(page)).accessories.find((piece: { id: string }) => piece.id === added.id)).toEqual(added);
});

test('physical review identifies a three-millimeter join gap, angular mismatch, and nominal turnout', async ({ page }) => {
  await seedLayout(page, fixtureLayout('Physical fit review', [
    fixtureTrack('first', 0),
    fixtureTrack('near-fit', 251, 0, { angle: Math.PI / 180 }),
    fixtureTrack('turnout', 1000, 150, { kind: 't4l', bend: -1, switchNumber: 4 }),
  ]));
  const report = await reviewLayout(page);
  await expect(report.getByText('Nearby connectors have a 3 mm gap', { exact: true })).toBeVisible();
  await expect(report.getByText('Nearby connectors differ by 1°', { exact: true })).toBeVisible();
  await expect(report.getByText('#4 Left uses nominal geometry', { exact: true })).toBeVisible();
  await expect(report.getByRole('row').filter({ hasText: '20-220' }).getByRole('cell').nth(3)).toHaveText('Approximate model · verify fit');
  await expect(report).toContainText('Connections must meet within 0.25 mm and 0.25°');
  await expect(report.getByText('Fix the reported conflicts before buying.', { exact: true })).toBeVisible();
});

test('an earlier colliding layout can be imported, inspected, and repaired rather than silently discarded', async ({ page }) => {
  await seedLayout(page, fixtureLayout('Empty import test', []));
  const colliding = fixtureLayout('Old colliding railway', [fixtureTrack('rail', -124)], [
    fixtureAccessory('platform', 'a-platform', 0, 0),
  ]);
  await importData(page, colliding);
  await expect(page.getByRole('heading', { name: colliding.name, exact: true })).toBeVisible();
  expect((await savedLayout(page)).accessories).toHaveLength(1);
  await expect.poll(async () => scene(page).evaluate(element => JSON.parse((element as HTMLCanvasElement).dataset.errorPieceIds ?? '[]'))).toEqual(expect.arrayContaining(['rail', 'platform']));
  const report = await reviewLayout(page);
  const conflict = report.locator('.check-issue.error').filter({ hasText: 'platform' }).first();
  await expect(conflict).toBeVisible();
  await conflict.getByRole('button', { name: 'Show DX island platform', exact: true }).click();
  await expect(report).toHaveCount(0);
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  expect((await savedLayout(page)).accessories).toHaveLength(0);
  const repaired = await reviewLayout(page);
  await expect(repaired.locator('.check-issue.error')).toHaveCount(0);
});
