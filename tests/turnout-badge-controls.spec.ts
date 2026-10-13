import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { makeCouplingDemo } from '../src/couplingDemo';
import { makeKatoPlan06 } from '../src/katoPlan06';
import { parseLayout } from '../src/layout';
import type { LayoutData } from '../src/layout';
import type { Track } from '../src/track';

// Use real canvas pointer input and actual blade vertices. Saved switch numbers
// alone would miss selecting a neighboring badge, a train, or a track instead.
test.use({ hasTouch: true });
test.setTimeout(150_000);
const STORAGE_KEY = 'little-railways-layout-v5';
const scene = (page: Page) => page.getByRole('img', {
  name: '3D railway layout: rotate, zoom, select trains, and move Kato track pieces',
});
const desk = (page: Page) => page.getByRole('region', { name: 'Turnout switch controls', exact: true });
type Point = { x: number; y: number; z: number };
type Badge = { id: string; number: number; state: 'straight' | 'branch'; screen: { x: number; y: number }; anchor: Point };
type Mechanism = {
  id: string; kind: string; state: 'straight' | 'branch'; fraction: number; target: number;
  pairs: { blades: { tip: Point; heel: Point; stockTip: Point }[] }[];
};
const gap = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function emptyLayout(name: string, tracks: Track[]): LayoutData {
  return { version: 5, name, tracks, accessories: [], trainType: 'e235', carCount: 3, trains: [], couplings: [] };
}
function turnout(id: string, x: number, y: number, switchNumber: number): Track {
  return { id, kind: 't4l', x, y, angle: 0, bend: 1, elevation: 0, endElevation: 0, switchNumber, switchState: 'straight' };
}
function catalogFixture(): LayoutData {
  const tracks: Track[] = ['t4l', 't4r', 't6l', 't6r', 'scissors'].flatMap((kind, index) => [-1, 1].map((bend, side) => ({
    id: `direct-${kind}-${bend}`, kind, x: index % 3 * 550 - 650, y: Math.floor(index / 3) * 950 + side * 400 - 600,
    angle: (index + side * 2) * Math.PI / 4, bend: bend as -1 | 1,
    elevation: side ? 60 : 0, endElevation: side ? 60 : 0,
    switchNumber: 20 - index * 3 - side, switchState: 'straight' as const,
  })));
  return emptyLayout('Direct turnout controls in every orientation', tracks.reverse());
}
async function start(page: Page, value: LayoutData) {
  const target = new Date('2026-10-13T00:00:00Z');
  await page.clock.install({ time: new Date(target.getTime() - 60_000) });
  await page.clock.pauseAt(target);
  await page.addInitScript(({ key, value }) => {
    if (sessionStorage.getItem('turnout-badge-control-fixture')) return;
    localStorage.setItem(key, JSON.stringify(value));
    sessionStorage.setItem('turnout-badge-control-fixture', 'installed');
  }, { key: STORAGE_KEY, value });
  await page.goto('./');
  await expect(scene(page)).toHaveAttribute('data-ready', 'true', { timeout: 90_000 });
  await page.clock.fastForward(200);
}
async function saved(page: Page): Promise<LayoutData> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY);
}
async function badges(page: Page): Promise<Badge[]> {
  return scene(page).evaluate(element => JSON.parse((element as HTMLCanvasElement).dataset.switchBadges ?? '[]'));
}
async function mechanisms(page: Page): Promise<Mechanism[]> {
  return scene(page).evaluate(element => JSON.parse((element as HTMLCanvasElement).dataset.turnoutPoints ?? '[]'));
}
async function cameraPose(page: Page): Promise<{ eye: Point; target: Point }> {
  return scene(page).evaluate(element => JSON.parse((element as HTMLCanvasElement).dataset.cameraPose!));
}
async function badgePoint(page: Page, id: string, aboveBase = 14) {
  const badge = (await badges(page)).find(value => value.id === id)!;
  expect(badge, `The rendered badge for ${id} exists`).toBeDefined();
  const bounds = (await scene(page).boundingBox())!;
  // The diagnostics project the sprite's bottom anchor. Its whole 28 CSS-pixel
  // badge is clickable; target its center, or its lower part over an occupied cab.
  const point = { x: bounds.x + badge.screen.x, y: bounds.y + badge.screen.y - aboveBase };
  expect(point.x).toBeGreaterThan(bounds.x);
  expect(point.x).toBeLessThan(bounds.x + bounds.width);
  expect(point.y).toBeGreaterThan(bounds.y);
  expect(point.y).toBeLessThan(bounds.y + bounds.height);
  return point;
}
async function clickBadge(page: Page, id: string, aboveBase = 14) {
  const point = await badgePoint(page, id, aboveBase);
  await page.mouse.click(point.x, point.y);
  await page.clock.fastForward(400);
}
function assertOnlyMoved(before: Mechanism[], after: Mechanism[], id: string, state: 'straight' | 'branch') {
  expect(after).toHaveLength(before.length);
  for (const initial of before) {
    const current = after.find(value => value.id === initial.id)!;
    if (initial.id !== id) {
      expect(current, `Clicking badge ${id} leaves turnout ${initial.id} unchanged`).toEqual(initial);
      continue;
    }
    expect(current.state).toBe(state);
    expect(current.target).toBe(state === 'branch' ? 1 : 0);
    expect(current.fraction).toBe(current.target);
    expect(current.pairs).toHaveLength(initial.kind === 'scissors' ? 4 : 1);
    for (const [pairIndex, pair] of current.pairs.entries()) for (const [bladeIndex, blade] of pair.blades.entries()) {
      const original = initial.pairs[pairIndex].blades[bladeIndex];
      expect(gap(blade.tip, original.tip), 'The matching actual point blade changes route').toBeGreaterThan(1.5);
      expect(gap(blade.heel, original.heel)).toBeLessThan(.05);
      expect(gap(blade.stockTip, original.stockTip)).toBeLessThan(.005);
    }
  }
}
async function topView(page: Page) {
  await page.getByRole('button', { name: 'Top view', exact: true }).click();
  await page.clock.runFor(200);
}

test('every turnout badge toggles its own points, with hover feedback, desk fallback, undo and reload', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const layout = catalogFixture();
  await start(page, layout);
  await expect(page.getByRole('button', { name: 'Toggle switch controls', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(desk(page)).toHaveCount(0);
  expect(await badges(page)).toHaveLength(10);
  for (const track of layout.tracks) {
    const before = await mechanisms(page);
    const point = await badgePoint(page, track.id);
    await page.mouse.move(point.x, point.y);
    await expect(scene(page)).toHaveCSS('cursor', 'pointer');
    await expect(scene(page)).toHaveAttribute('title', `Switch ${track.switchNumber}: straight. Click or tap to take the branch route.`);
    await clickBadge(page, track.id);
    assertOnlyMoved(before, await mechanisms(page), track.id, 'branch');
    expect((await badges(page)).find(value => value.id === track.id)!.state).toBe('branch');
  }
  const target = layout.tracks[0];
  await page.getByRole('button', { name: 'Toggle switch controls', exact: true }).click();
  await expect(desk(page)).toBeVisible();
  const beforeDesk = await mechanisms(page);
  await desk(page).getByRole('button', { name: `Switch ${target.switchNumber} straight`, exact: true }).click();
  await page.clock.fastForward(400);
  assertOnlyMoved(beforeDesk, await mechanisms(page), target.id, 'straight');
  await page.getByRole('button', { name: 'Undo last change', exact: true }).click();
  await page.clock.fastForward(400);
  expect((await mechanisms(page)).find(value => value.id === target.id)!.state).toBe('branch');
  const latest = await saved(page);
  expect(latest.tracks.map(({ switchState: _state, ...track }) => track)).toEqual(layout.tracks.map(({ switchState: _state, ...track }) => track));
  await page.reload();
  await expect(scene(page)).toHaveAttribute('data-ready', 'true');
  await page.clock.fastForward(200);
  expect((await saved(page)).tracks).toEqual(latest.tracks);
  expect((await badges(page)).every(value => value.state === 'branch')).toBe(true);
  await expect(page.getByRole('button', { name: 'Toggle switch controls', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await page.clock.runFor(100);
  await scene(page).screenshot({ path: info.outputPath('direct-turnout-controls-catalog.png') });
  expect(errors).toEqual([]);
});

test('the original adjacent 1 and 4 badges operate the correct turnout in perspective and top views', async ({ page }, info) => {
  const original = parseLayout(makeKatoPlan06());
  const tracks = original.tracks.filter(track => track.switchNumber === 1 || track.switchNumber === 4);
  await start(page, emptyLayout('Direct controls for the original 1 and 4 pair', tracks));
  for (const view of ['perspective', 'top']) {
    if (view === 'top') await topView(page);
    for (const track of tracks) {
      let before = await mechanisms(page);
      await clickBadge(page, track.id);
      assertOnlyMoved(before, await mechanisms(page), track.id, 'branch');
      before = await mechanisms(page);
      await clickBadge(page, track.id);
      assertOnlyMoved(before, await mechanisms(page), track.id, 'straight');
    }
    await page.clock.runFor(100);
    await scene(page).screenshot({ path: info.outputPath(`direct-adjacent-1-and-4-${view}.png`) });
  }
  expect((await saved(page)).tracks).toEqual(tracks);
});

test('camera gestures, cancellation and multiple touches do not switch, while move mode and phone taps work', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const tracks: Track[] = [turnout('gesture-switch', -180, 0, 1), turnout('other-switch', 400, 300, 4), {
    id: 'movable-straight', kind: 's248', x: -180, y: 400, angle: 0, bend: 1, elevation: 0, endElevation: 0,
  }];
  await start(page, emptyLayout('Deliberate badge taps and ordinary track movement', tracks));
  await topView(page);
  let point = await badgePoint(page, 'gesture-switch');
  const beforeOrbit = await cameraPose(page);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 45, point.y + 15, { steps: 4 });
  await page.clock.runFor(100);
  expect(gap(beforeOrbit.eye, (await cameraPose(page)).eye), 'Dragging from a badge still rotates the camera').toBeGreaterThan(.1);
  await page.mouse.move(point.x, point.y, { steps: 4 });
  await page.mouse.up();
  await page.clock.fastForward(200);
  expect((await saved(page)).tracks).toEqual(tracks);
  point = await badgePoint(page, 'gesture-switch');
  const beforePan = await cameraPose(page);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(point.x + 40, point.y + 10, { steps: 4 });
  await page.mouse.up({ button: 'right' });
  await page.clock.fastForward(200);
  expect(gap(beforePan.target, (await cameraPose(page)).target), 'Right dragging from a badge still pans the camera').toBeGreaterThan(.1);
  expect((await saved(page)).tracks).toEqual(tracks);
  await page.getByRole('button', { name: 'Fit railway to view', exact: true }).click();
  await page.clock.fastForward(200);
  await topView(page);
  const cdp = await page.context().newCDPSession(page);
  point = await badgePoint(page, 'gesture-switch');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 11, ...point }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await page.clock.fastForward(200);
  expect((await saved(page)).tracks).toEqual(tracks);
  point = await badgePoint(page, 'gesture-switch');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 12, ...point }, { id: 13, x: point.x + 60, y: point.y + 25 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.clock.fastForward(200);
  expect((await saved(page)).tracks).toEqual(tracks);
  await cdp.detach();
  await page.getByRole('button', { name: 'Move pieces', exact: true }).click();
  await clickBadge(page, 'gesture-switch');
  expect((await saved(page)).tracks.find(track => track.id === 'gesture-switch')).toEqual({ ...tracks[0], switchState: 'branch' });
  const body = await scene(page).evaluate(element => {
    const canvas = element as HTMLCanvasElement;
    const point = JSON.parse(canvas.dataset.pickPoints!)["movable-straight"];
    const bounds = element.getBoundingClientRect();
    return { x: bounds.x + point.x, y: bounds.y + point.y };
  });
  await page.mouse.move(body.x, body.y);
  await page.mouse.down();
  await page.mouse.move(body.x + 40, body.y, { steps: 5 });
  await page.mouse.up();
  await page.clock.fastForward(200);
  expect((await saved(page)).tracks.find(track => track.id === 'movable-straight')).not.toEqual(tracks[2]);
  expect((await saved(page)).tracks.find(track => track.id === 'gesture-switch')).toEqual({ ...tracks[0], switchState: 'branch' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.runFor(200);
  point = await badgePoint(page, 'gesture-switch');
  await page.touchscreen.tap(point.x, point.y);
  await page.clock.fastForward(400);
  expect((await badges(page)).find(value => value.id === 'gesture-switch')!.state).toBe('straight');
  await expect(page.getByRole('button', { name: 'Move pieces', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.clock.runFor(100);
  await page.screenshot({ path: info.outputPath('phone-direct-turnout-tap.png') });
  // The disconnected pieces cannot hold three cars, so the public Add train
  // flow enters rail placement. Its gestures must take priority over badges.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.clock.runFor(200);
  await page.getByRole('button', { name: 'Add train', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancel train placement', exact: true })).toBeVisible();
  await page.clock.fastForward(200);
  const placementTracks = (await saved(page)).tracks;
  point = await badgePoint(page, 'gesture-switch');
  await page.mouse.move(point.x, point.y);
  await expect(scene(page)).toHaveCSS('cursor', 'crosshair');
  await expect(scene(page)).not.toHaveAttribute('title');
  await clickBadge(page, 'gesture-switch');
  expect((await saved(page)).tracks).toEqual(placementTracks);
  await expect(page.getByRole('button', { name: 'Cancel train placement', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('badges take priority over a visible parked cab and preserve occupancy and coupling protection', async ({ page }) => {
  const tracks: Track[] = [...Array.from({ length: 4 }, (_, index): Track => ({
    id: `occupied-approach-${index}`, kind: 's248', x: index * 248, y: 0, angle: 0, bend: 1, elevation: 0, endElevation: 0,
  })), turnout('occupied-switch', 992, 0, 1)];
  const layout = emptyLayout('A numbered badge above an occupied cab', tracks);
  layout.trains = [
    { id: 'parked-cab', name: 'Parked Yamanote', type: 'e235', carCount: 3, cabForward: true, requestedSpeed: 20,
      position: { trackId: 'occupied-switch', distance: 100, direction: 1, route: 0, laps: 0 } },
    { id: 'selected-away', name: 'Other train', type: 'e7', carCount: 3, cabForward: true, requestedSpeed: 20, position: null },
  ];
  layout.selectedTrainId = 'selected-away';
  await start(page, layout);
  await topView(page);
  await expect(scene(page)).toHaveAttribute('data-selected-train-id', 'selected-away');
  const before = await mechanisms(page);
  const beforeFleet = await scene(page).getAttribute('data-fleet-poses');
  const anchor = (await badges(page)).find(value => value.id === 'occupied-switch')!.anchor;
  const cab = await scene(page).evaluate(element => JSON.parse((element as HTMLCanvasElement).dataset.fleetPoses!).find((train: { id: string }) => train.id === 'parked-cab').cars[0]);
  expect(anchor.x).toBeGreaterThan(Math.min(cab.frontEnd.x, cab.rearEnd.x));
  expect(anchor.x).toBeLessThan(Math.max(cab.frontEnd.x, cab.rearEnd.x));
  // Tap the badge's lower area directly over the cab roof rather than an empty
  // portion above it. The protected switch command must win over train picking.
  await clickBadge(page, 'occupied-switch', 3);
  await expect(page.getByRole('alert')).toContainText('Switch 1 is occupied');
  expect(await mechanisms(page)).toEqual(before);
  expect(await scene(page).getAttribute('data-fleet-poses')).toBe(beforeFleet);
  await expect(scene(page)).toHaveAttribute('data-selected-train-id', 'selected-away');
  const practice = makeCouplingDemo({ firstType: 'e7', secondType: 'e5' });
  practice.tracks.push(turnout('coupling-clear-switch', 0, -850, 9));
  await page.getByLabel('Open railway file').setInputFiles({
    name: 'coupling-guard-with-badge.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(practice)),
  });
  await page.clock.runFor(200);
  await expect(page.getByRole('button', { name: 'Couple trains', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Couple trains', exact: true }).click();
  await page.getByRole('button', { name: 'Pause coupling', exact: true }).click();
  await page.clock.fastForward(200);
  // Joining automatically focuses the nose camera. Return to a layout view
  // before operating the separate, unoccupied test turnout.
  await topView(page);
  const protectedPoints = await mechanisms(page);
  await clickBadge(page, 'coupling-clear-switch');
  await expect(page.getByRole('alert')).toContainText('Finish joining or separating the trains before changing the railway');
  expect(await mechanisms(page)).toEqual(protectedPoints);
  expect((await saved(page)).tracks.find(track => track.id === 'coupling-clear-switch')!.switchState).toBe('straight');
  await expect(page.getByRole('button', { name: 'Continue coupling', exact: true })).toBeVisible();
});
