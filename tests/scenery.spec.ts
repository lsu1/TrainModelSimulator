import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { makeKatoPlan02 } from '../src/katoPlan';
import { createLayout, parseLayout } from '../src/layout';
import type { LayoutData } from '../src/layout';
import type { Track } from '../src/track';
import { openMoreTools } from './builder-navigation';

// Keep the expensive railway renderer idle except when checking the actual
// moving-car meshes or the result of a canvas gesture.
test.use({ hasTouch: true });
test.setTimeout(180_000);
const STORAGE_KEY = 'little-railways-layout-v5';
const LIBRARY_KEY = 'little-railways-saved-designs-v1';
const scene = (page: Page) => page.getByRole('img', {
  name: '3D railway layout: rotate, zoom, select trains, and move Kato track pieces',
});
const panel = (page: Page) => page.locator('#builder-panel-scenery');
type Point = { x: number; y: number };
type RenderObject = Point & { id: string; kind: string; angle: number; screen: Point };
type RenderRoad = { id: string; points: Point[]; width: number; closed: boolean };
type RenderCar = Point & { id: string; roadId: string; lane: 1 | -1; angle: number; moving: boolean };
type RenderScenery = { preview: boolean; objects: RenderObject[]; roads: RenderRoad[]; rivers: unknown[]; cars: RenderCar[] };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

async function start(page: Page, layout: LayoutData) {
  const target = new Date('2026-10-13T00:00:00Z');
  await page.clock.install({ time: new Date(target.getTime() - 60_000) });
  await page.clock.pauseAt(target);
  await page.addInitScript(({ key, value, libraryKey }) => {
    if (sessionStorage.getItem('scenery-test-fixture')) return;
    localStorage.setItem(key, JSON.stringify(value));
    localStorage.setItem(libraryKey, JSON.stringify({ version: 1, designs: [] }));
    sessionStorage.setItem('scenery-test-fixture', 'installed');
  }, { key: STORAGE_KEY, value: layout, libraryKey: LIBRARY_KEY });
  await page.goto('./');
  await expect(scene(page)).toHaveAttribute('data-ready', 'true', { timeout: 90_000 });
  await page.clock.fastForward(200);
  await sceneryTab(page);
}

async function sceneryTab(page: Page) {
  await page.getByRole('tab', { name: 'Scenery', exact: true }).click();
  await expect(panel(page)).toBeVisible();
}
async function saved(page: Page): Promise<LayoutData> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY);
}
async function rendered(page: Page): Promise<RenderScenery> {
  return scene(page).evaluate(element => JSON.parse((element as HTMLCanvasElement).dataset.scenery!));
}
function railwayOnly(layout: LayoutData) {
  return { tracks: layout.tracks, accessories: layout.accessories, trains: layout.trains,
    couplings: layout.couplings, selectedTrainId: layout.selectedTrainId,
    sourcePlan: layout.sourcePlan, trainType: layout.trainType, carCount: layout.carCount };
}
function customRailway(): LayoutData {
  const source = createLayout('compact');
  const rotation = Math.PI / 3;
  const shift = (point: Point) => ({ x: 2600 + point.x * Math.cos(rotation) - point.y * Math.sin(rotation),
    y: -1700 + point.x * Math.sin(rotation) + point.y * Math.cos(rotation) });
  const tracks: Track[] = source.tracks.map(track => ({ ...track, ...shift(track), id: `custom-${track.id}`, angle: track.angle + rotation }));
  tracks.push({ id: 'custom-switch', kind: 't4l', x: 1700, y: -2400, angle: Math.PI / 4,
    bend: 1, elevation: 0, endElevation: 0, switchNumber: 7, switchState: 'straight' });
  return parseLayout({ version: 5, name: 'Our rotated railway, not a preset', tracks,
    accessories: [{ id: 'our-platform', kind: 'a-platform', x: 2700, y: -1660, angle: rotation, elevation: 0, stationName: '小朋友站' }],
    trains: [], couplings: [], carCount: 3, trainType: 'e235' });
}
async function topView(page: Page) {
  await page.getByRole('button', { name: 'Top view', exact: true }).click();
  await page.clock.runFor(200);
}
async function clickBadge(page: Page, id: string) {
  const badge = await scene(page).evaluate((element, id) => JSON.parse((element as HTMLCanvasElement).dataset.switchBadges!)
    .find((value: { id: string }) => value.id === id), id);
  const box = (await scene(page).boundingBox())!;
  await page.mouse.click(box.x + badge.screen.x, box.y + badge.screen.y - 14);
  await page.clock.fastForward(400);
}
function segmentDistance(point: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const fraction = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return distance(point, { x: a.x + dx * fraction, y: a.y + dy * fraction });
}
function assertCarsOnRoads(snapshot: RenderScenery) {
  expect(snapshot.cars.length).toBeGreaterThan(0);
  for (const car of snapshot.cars) {
    const road = snapshot.roads.find(value => value.id === car.roadId)!;
    expect(road, `Rendered car ${car.id} belongs to a rendered road`).toBeDefined();
    expect(road.closed).toBe(true);
    const segments = road.points.map((point, index) => [point, road.points[(index + 1) % road.points.length]]);
    expect(Math.min(...segments.map(([a, b]) => segmentDistance(car, a, b))), `Car ${car.id} stays within its actual road`).toBeLessThanOrEqual(road.width / 2 + 2);
  }
}

async function generateCity(page: Page, prompt = 'A city with apartments, shops, roads, cars, people, trees and parks.') {
  await panel(page).getByRole('button', { name: 'City', exact: true }).click();
  await panel(page).getByRole('textbox', { name: 'What would you like around your railway?', exact: true }).fill(prompt);
  await panel(page).getByRole('button', { name: 'Build my city', exact: true }).click();
  await page.clock.fastForward(200);
  await expect(panel(page).getByText('Preview · not saved yet', { exact: true })).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Keep this city', exact: true })).toBeEnabled();
  // Generation runs in a timer. React commits its result after that clock
  // advance, so give the renderer its next frame once the preview UI is ready.
  await page.clock.fastForward(200);
  expect((await rendered(page)).preview).toBe(true);
}
async function keepCity(page: Page) {
  await panel(page).getByRole('button', { name: 'Keep this city', exact: true }).click();
  await page.clock.fastForward(200);
  expect((await rendered(page)).preview).toBe(false);
  const plan = (await saved(page)).scenery;
  expect(plan).toBeDefined();
  return plan!;
}
async function saveNamed(page: Page, name: string) {
  await page.getByRole('button', { name: 'Save layout', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save your railway', exact: true });
  await dialog.getByRole('textbox', { name: 'Layout name', exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Save layout', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
function carPoses(snapshot: RenderScenery) {
  return snapshot.cars.map(({ id, x, y, angle }) => ({ id, x, y, angle }));
}

test('M1 city preview stays separate, accepts one undoable change and survives named save, export and reload', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await start(page, parseLayout(makeKatoPlan02()));
  const original = await saved(page);
  await generateCity(page);
  const firstPreview = await rendered(page);
  expect(firstPreview.objects.some(object => ['house', 'shop', 'apartment', 'office'].includes(object.kind))).toBe(true);
  expect(firstPreview.objects.some(object => object.kind === 'person')).toBe(true);
  expect(firstPreview.objects.some(object => object.kind === 'park')).toBe(true);
  assertCarsOnRoads(firstPreview);
  expect(await saved(page)).toEqual(original);
  await panel(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.clock.fastForward(200);
  expect(await saved(page)).toEqual(original);
  expect((await rendered(page)).objects).toHaveLength(0);

  await generateCity(page);
  const nextPreview = await rendered(page);
  await panel(page).getByRole('button', { name: 'Try another', exact: true }).click();
  await page.clock.fastForward(200);
  await expect(panel(page).getByRole('button', { name: 'Keep this city', exact: true })).toBeEnabled();
  await page.clock.fastForward(200);
  expect((await rendered(page)).objects.map(object => object.id)).not.toEqual(nextPreview.objects.map(object => object.id));
  expect(await saved(page)).toEqual(original);
  const accepted = await keepCity(page);
  expect(railwayOnly(await saved(page))).toEqual(railwayOnly(original));
  await page.getByRole('button', { name: 'Undo last change', exact: true }).click();
  await page.clock.fastForward(200);
  expect(await saved(page)).toEqual(original);
  expect((await rendered(page)).objects).toHaveLength(0);

  await generateCity(page, '城市里有公寓、商店、道路、汽车、行人、树木和公园。');
  const kept = await keepCity(page);
  expect(kept.seed).not.toBe(accepted.seed);
  const poses = (await rendered(page)).objects.map(({ id, kind, x, y, angle }) => ({ id, kind, x, y, angle }));
  await saveNamed(page, 'Our railway in a city');
  const library = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), LIBRARY_KEY);
  expect(library.designs).toHaveLength(1);
  expect(library.designs[0].layout.scenery).toEqual(kept);
  expect(railwayOnly(library.designs[0].layout)).toEqual(railwayOnly(original));

  await openMoreTools(page);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save a layout file', exact: true }).click();
  const path = info.outputPath('m1-city-surroundings.json');
  await (await download).saveAs(path);
  const exported: LayoutData = JSON.parse(await readFile(path, 'utf8'));
  expect(exported.scenery).toEqual(kept);
  expect(railwayOnly(exported)).toEqual(railwayOnly(original));
  await page.reload();
  await expect(scene(page)).toHaveAttribute('data-ready', 'true');
  await page.clock.fastForward(200);
  expect((await saved(page)).scenery).toEqual(kept);
  expect((await rendered(page)).objects.map(({ id, kind, x, y, angle }) => ({ id, kind, x, y, angle }))).toEqual(poses);
  expect(railwayOnly(await saved(page))).toEqual(railwayOnly(original));
  await sceneryTab(page);
  await page.clock.runFor(100);
  await scene(page).screenshot({ path: info.outputPath('m1-city-live-surroundings.png') });
  expect(errors).toEqual([]);
});

test('a custom rotated railway receives scenery and real moving road cars, with independent pause and normal badge controls', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await start(page, customRailway());
  const original = await saved(page);
  await generateCity(page);
  const plan = await keepCity(page);
  expect(plan.bounds.minX).toBeGreaterThan(1000);
  expect(plan.bounds.maxY).toBeLessThan(0);
  expect(railwayOnly(await saved(page))).toEqual(railwayOnly(original));
  const initial = await rendered(page);
  assertCarsOnRoads(initial);
  await page.clock.runFor(300);
  const moving = await rendered(page);
  assertCarsOnRoads(moving);
  expect(moving.cars.filter(car => distance(car, initial.cars.find(value => value.id === car.id)!) > 1).length).toBeGreaterThan(0);
  expect(moving.cars.some(car => car.moving)).toBe(true);
  await panel(page).getByRole('checkbox', { name: 'Moving road traffic', exact: true }).uncheck();
  await page.clock.fastForward(200);
  const paused = await rendered(page);
  expect((await saved(page)).scenery!.trafficPlaying).toBe(false);
  await page.clock.runFor(300);
  expect(carPoses(await rendered(page))).toEqual(carPoses(paused));
  await panel(page).getByRole('checkbox', { name: 'Moving road traffic', exact: true }).check();
  await page.clock.runFor(300);
  expect(carPoses(await rendered(page))).not.toEqual(carPoses(paused));
  expect((await saved(page)).scenery!.cars).toEqual(plan.cars);

  await topView(page);
  await clickBadge(page, 'custom-switch');
  await expect(page.getByRole('tab', { name: 'Scenery', exact: true })).toHaveAttribute('aria-selected', 'true');
  const changed = await saved(page);
  expect(changed.tracks.find(track => track.id === 'custom-switch')!.switchState).toBe('branch');
  expect(changed.tracks.filter(track => track.id !== 'custom-switch')).toEqual(original.tracks.filter(track => track.id !== 'custom-switch'));
  expect(changed.scenery).toEqual(plan);
  expect(changed.accessories).toEqual(original.accessories);

  // Entering the piece editor hides Scenery. A marking mode started there
  // must stop immediately rather than capturing otherwise normal view drags.
  await page.getByRole('button', { name: 'Toggle switch controls', exact: true }).click();
  await page.getByRole('region', { name: 'Turnout switch controls', exact: true })
    .getByRole('button', { name: 'Show switch 7', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Mark an area', exact: true }).click();
  await expect(panel(page).getByRole('button', { name: 'Done marking', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit selected piece', exact: true }).click();
  await expect(page.locator('#builder-panel-editor')).toBeVisible();
  await page.clock.fastForward(200);
  const bounds = (await scene(page).boundingBox())!;
  const viewPoint = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  await page.mouse.move(viewPoint.x, viewPoint.y);
  await expect(scene(page)).not.toHaveCSS('cursor', 'crosshair');
  const beforeDrag = await scene(page).getAttribute('data-camera-pose');
  await page.mouse.down();
  await page.mouse.move(viewPoint.x + 40, viewPoint.y + 15, { steps: 4 });
  await page.mouse.up();
  await page.clock.runFor(100);
  expect(await scene(page).getAttribute('data-camera-pose')).not.toBe(beforeDrag);
  expect(await scene(page).getAttribute('data-scenery-area')).toBe('null');
  expect(await saved(page)).toEqual(changed);
  await page.clock.runFor(100);
  await scene(page).screenshot({ path: info.outputPath('custom-rotated-city-road-traffic.png') });
  expect(errors).toEqual([]);
});

test('phone ground marking changes only the chosen area and ordinary camera dragging does not mark it', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page, customRailway());
  await generateCity(page);
  const original = await keepCity(page);
  // Four tools remain usable without making the whole page wider or moving the
  // railway out of view; controls scroll within their existing panel.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const name of ['Pieces', 'Ramp', 'Helper', 'Scenery']) {
    await page.getByRole('tab', { name, exact: true }).click();
    await expect(scene(page)).toBeInViewport();
  }
  await topView(page);
  const box = (await scene(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 25, box.y + box.height / 2 + 10, { steps: 4 });
  await page.mouse.up();
  await page.clock.fastForward(200);
  expect(await scene(page).getAttribute('data-scenery-area')).toBe('null');
  expect((await saved(page)).scenery).toEqual(original);
  await page.getByRole('button', { name: 'Fit railway to view', exact: true }).click();
  await page.clock.runFor(200);
  await topView(page);

  await panel(page).getByRole('button', { name: 'Mark an area', exact: true }).click();
  await expect(panel(page).getByRole('button', { name: 'Done marking', exact: true })).toBeVisible();
  await panel(page).getByRole('button', { name: 'Done marking', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Mark an area', exact: true }).click();
  const bounds = (await scene(page).boundingBox())!;
  const object = (await rendered(page)).objects.find(value => value.screen.x > 40 && value.screen.x < bounds.width - 40
    && value.screen.y > 25 && value.screen.y < bounds.height - 25)!;
  expect(object, 'An actual scenery object supplies a visible ground location').toBeDefined();
  const point = { x: bounds.x + object.screen.x, y: bounds.y + object.screen.y };
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 18, point.y, { steps: 4 });
  await page.mouse.up();
  await page.clock.fastForward(200);
  const area: Point & { radius: number } = await scene(page).evaluate(element => JSON.parse((element as HTMLCanvasElement).dataset.sceneryArea!));
  expect(distance(area, object)).toBeLessThan(8);
  expect(area.radius).toBeGreaterThanOrEqual(100);
  await expect(panel(page).getByRole('button', { name: 'Mark another area', exact: true })).toBeVisible();
  await panel(page).getByRole('button', { name: 'Small', exact: true }).click();
  await page.clock.fastForward(200);
  const selected: Point & { radius: number } = await scene(page).evaluate(element => JSON.parse((element as HTMLCanvasElement).dataset.sceneryArea!));
  const outside = original.objects.filter(value => distance(value, selected) > selected.radius);
  const inside = original.objects.filter(value => distance(value, selected) <= selected.radius);
  expect(outside.length).toBeGreaterThan(0);
  expect(inside.length).toBeGreaterThan(0);
  await panel(page).getByRole('textbox', { name: 'What should go here?', exact: true }).fill('A small park with trees and a playground.');
  await panel(page).getByRole('button', { name: 'Change this area', exact: true }).click();
  await page.clock.fastForward(200);
  await expect(panel(page).getByRole('button', { name: 'Keep this change', exact: true })).toBeEnabled();
  await page.clock.fastForward(200);
  expect((await rendered(page)).preview).toBe(true);
  expect((await saved(page)).scenery).toEqual(original);
  await panel(page).getByRole('button', { name: 'Keep this change', exact: true }).click();
  await page.clock.fastForward(200);
  const changed = (await saved(page)).scenery!;
  expect(changed.objects.filter(value => outside.some(initial => initial.id === value.id))).toEqual(outside);
  expect(changed.objects.some(value => inside.some(initial => initial.id === value.id))).toBe(false);
  expect(changed.roads).toEqual(original.roads);
  expect(changed.cars).toEqual(original.cars);
  await page.clock.runFor(100);
  await page.screenshot({ path: info.outputPath('phone-local-city-scenery-change.png') });
  await page.getByRole('button', { name: 'Undo last change', exact: true }).click();
  await page.clock.fastForward(200);
  expect((await saved(page)).scenery).toEqual(original);
  expect(errors).toEqual([]);
});
