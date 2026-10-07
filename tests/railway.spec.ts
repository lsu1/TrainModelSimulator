import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Software WebGL may compile several detailed catalog models per workflow.
test.setTimeout(60_000);

const STORAGE_KEY = 'little-railways-layout-v2';
const canvasName = '3D railway layout: rotate, zoom, and move Kato track pieces';
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

async function freezeAnimationClock(page: Page) {
  const time = new Date('2026-01-01T00:00:00Z');
  await page.clock.install({ time });
  await page.clock.pauseAt(time);
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
  await expect(page.getByText('136 catalog pieces to discover.', { exact: true })).toBeVisible();
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
  await expect(slider).toHaveValue('120');
  await advanceAnimation(page, 400);
  const fast = await trainPoint(page);
  expect(fast.x - slow.x).toBeGreaterThan((slow.x - initial.x) * 10);
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
  const formation = page.getByRole('combobox', { name: 'Train car count' });
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
  await expect(links).toHaveCount(8);
  for (const link of await links.all()) expect(await link.getAttribute('href')).toMatch(/^https:\/\/(katousa\.com|www\.katomodels\.com|unitrack\.katomodels\.com)\//);
});

test('eight curves build a closed 3D loop, with removal and undo restoring the connection', async ({ page }) => {
  await openRailway(page);
  await startFresh(page);
  await expect(page.getByRole('button', { name: 'Run train', exact: true })).toBeDisabled();
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
  await page.getByRole('button', { name: straightButton, exact: true }).click();
  await page.getByLabel('Selected piece height').fill('80');
  await page.getByLabel('Selected track end height').fill('100');
  await expect(page.getByText('8.1% slope · steep for a physical train', { exact: true })).toBeVisible();
  await expect.poll(async () => (await trainPoint(page)).z).toBeGreaterThan(80);
  expect((await trainPoint(page)).z).toBeLessThan(100);
  await page.getByRole('button', { name: 'Rotate selected piece' }).click();
  const track = (await savedLayout(page)).tracks[0];
  expect(track.angle).toBeCloseTo(Math.PI / 4);
  expect(track.elevation).toBe(80);
  expect(track.endElevation).toBe(100);
  await expect(page.getByRole('link', { name: 'See this piece in the Kato catalog' })).toHaveAttribute('href', /katousa\.com/);
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
  await page.getByRole('searchbox', { name: 'Search Kato catalog' }).fill('20-220');
  await page.getByRole('button', { name: 'Add #4 left turnout', exact: true }).click();
  await page.getByRole('button', { name: 'Branch route', exact: true }).click();
  await advanceAnimation(page, 100);
  expect((await trainPoint(page)).y).toBeLessThan(-.5);
});

test('version 2 saves export tracks, scenery, heights, and train formation and can be reopened', async ({ page }, testInfo) => {
  await openRailway(page);
  await startFresh(page);
  await page.getByRole('button', { name: straightButton, exact: true }).click();
  await page.getByLabel('Selected piece height').fill('80');
  await page.getByRole('searchbox', { name: 'Search Kato catalog' }).fill('23-150');
  await page.getByRole('button', { name: 'Add Modern DX island platform A · 248 mm', exact: true }).click();
  await page.getByRole('combobox', { name: 'Train car count' }).selectOption('6');
  const saved = await savedLayout(page);
  expect(saved.version).toBe(2);
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
  expect(migrated).toEqual({ ...legacy, version: 2, tracks: [{ ...legacy.tracks[0], elevation: 0, endElevation: 0 }], accessories: [], carCount: 11 });
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
  expect(await savedLayout(page)).toEqual(imported);
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

async function seedLayout(page: Page, layout: ReturnType<typeof fixtureLayout>) {
  await page.addInitScript(value => {
    if (!localStorage.getItem('little-railways-layout-v2')) {
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
  await advanceAnimation(page, 650);
  expect((await trainPoint(page)).x).toBeGreaterThan(beforeSwitch.x);
  await desk.getByRole('button', { name: 'Switch 1 branch', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Switch 1 is occupied');
  await expect(desk.getByRole('button', { name: 'Switch 1 straight', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Pause train', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pause train', exact: true }).click();
  await desk.getByRole('button', { name: 'Switch 1 branch', exact: true }).click();
  await expect(desk.getByRole('button', { name: 'Switch 1 branch', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await advanceAnimation(page, 200);
  const badges = await scene(page).evaluate(element => JSON.parse((element as HTMLCanvasElement).dataset.switchNumbers!));
  expect(badges).toEqual([
    { id: 'switch-near', number: 1, state: 'branch' },
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
