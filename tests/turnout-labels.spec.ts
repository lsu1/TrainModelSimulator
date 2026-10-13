import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { makeKatoPlan02 } from '../src/katoPlan';
import { makeKatoPlan06 } from '../src/katoPlan06';
import { parseLayout } from '../src/layout';
import type { LayoutData } from '../src/layout';
import { pathsFor } from '../src/track';
import type { Track } from '../src/track';
import { editSelectedPiece } from './builder-navigation';

// Read actual Scene3D objects and point-blade vertices, as a saved number alone
// cannot catch a badge visually pointing to the adjacent parallel turnout.
test.setTimeout(360_000);
const STORAGE_KEY = 'little-railways-layout-v5';
const scene = (page: Page) => page.getByRole('img', {
  name: '3D railway layout: rotate, zoom, select trains, and move Kato track pieces',
});
const desk = (page: Page) => page.getByRole('region', { name: 'Turnout switch controls', exact: true });

async function openSwitchDesk(page: Page) {
  const toggle = page.getByRole('button', { name: 'Toggle switch controls', exact: true });
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
}

type Point = { x: number; y: number; z: number };
type ScreenPoint = { x: number; y: number };
type Badge = {
  id: string; number: number; state: 'straight' | 'branch';
  position: Point; screen: ScreenPoint; anchor: Point; anchorScreen: ScreenPoint;
  leaderStart: Point; leaderEnd: Point;
};
type Mechanism = {
  id: string; kind: string; state: 'straight' | 'branch'; fraction: number; target: number;
  pairs: { blades: { tip: Point; heel: Point; stockTip: Point }[] }[];
};
const gap = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function clearTrains(layout: LayoutData): LayoutData {
  // M1 is an older single-train preset. Migrate before clearing its fleet so
  // the occupied-switch guard remains a separate test, rather than a fixture accident.
  const value: LayoutData = { ...parseLayout(layout), version: 5, trains: [], couplings: [] };
  delete value.selectedTrainId;
  return value;
}

async function start(page: Page, value: LayoutData) {
  const target = new Date('2026-10-13T00:00:00Z');
  await page.clock.install({ time: new Date(target.getTime() - 60_000) });
  await page.clock.pauseAt(target);
  await page.addInitScript(({ key, value }) => {
    if (sessionStorage.getItem('turnout-label-fixture')) return;
    localStorage.setItem(key, JSON.stringify(value));
    sessionStorage.setItem('turnout-label-fixture', 'installed');
  }, { key: STORAGE_KEY, value });
  await page.goto('./');
  await expect(scene(page)).toHaveAttribute('data-ready', 'true', { timeout: 90_000 });
  await expect(page.getByLabel('Train count', { exact: true })).toHaveText('0 trains');
  await openSwitchDesk(page);
  await page.clock.fastForward(16);
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

function assertAnchors(rendered: Badge[], tracks: Track[]) {
  const switches = tracks.filter(track => track.switchNumber !== undefined);
  expect(rendered).toHaveLength(switches.length);
  expect(new Set(rendered.map(badge => badge.number)).size).toBe(switches.length);
  for (const track of switches) {
    const badge = rendered.find(badge => badge.id === track.id)!;
    expect(badge, `Turnout ${track.switchNumber} has a real rendered badge`).toBeDefined();
    expect(badge.number).toBe(track.switchNumber);
    expect(badge.state).toBe(track.switchState ?? 'straight');
    const route = pathsFor(track)[0];
    const ownRail = route.pointAt(Math.min(38, route.length / 4));
    expect(Math.hypot(badge.anchor.x - ownRail.x, badge.anchor.y - ownRail.y),
      `Label ${badge.number} points to its own rail rather than the adjacent parallel rail`).toBeLessThan(.01);
    expect(badge.anchor.z).toBeGreaterThanOrEqual(ownRail.z);
    expect(badge.anchor.z).toBeLessThan(ownRail.z + 15);
    expect(badge.anchor.z).toBeCloseTo(ownRail.z + 7.35, 4);
    expect(gap(badge.leaderStart, badge.anchor), 'The actual stem starts on the numbered turnout rail').toBeLessThan(.001);
    expect(gap(badge.leaderEnd, badge.position), 'The actual stem reaches the bottom of the matching badge').toBeLessThan(.001);
    expect(gap(badge.leaderStart, badge.leaderEnd)).toBeCloseTo(6, 4);
    for (const value of [badge.position.x, badge.position.y, badge.position.z, badge.screen.x, badge.screen.y, badge.anchorScreen.x, badge.anchorScreen.y]) {
      expect(Number.isFinite(value)).toBe(true);
    }
  }
}

function assertOnlyPointMoved(before: Mechanism[], after: Mechanism[], id: string) {
  expect(after).toHaveLength(before.length);
  for (const initial of before) {
    const current = after.find(mechanism => mechanism.id === initial.id)!;
    if (initial.id !== id) {
      expect(current, `Control for ${id} leaves other turnout ${initial.id} untouched`).toEqual(initial);
      continue;
    }
    expect(current.state).toBe('branch');
    expect(current.target).toBe(1);
    expect(current.fraction).toBe(1);
    expect(current.pairs).toHaveLength(initial.kind === 'scissors' ? 4 : 1);
    for (const [pairIndex, pair] of current.pairs.entries()) {
      for (const [bladeIndex, blade] of pair.blades.entries()) {
        const original = initial.pairs[pairIndex].blades[bladeIndex];
        expect(gap(blade.tip, original.tip), `The actual ${id} blade mesh moves`).toBeGreaterThan(1.5);
        expect(gap(blade.heel, original.heel), 'The blade remains attached to its own heel').toBeLessThan(.05);
        expect(gap(blade.stockTip, original.stockTip), 'The stock rail stays fixed').toBeLessThan(.005);
      }
    }
  }
}

async function checkEveryControl(page: Page, tracks: Track[]) {
  const switches = tracks.filter(track => track.switchNumber !== undefined).sort((a, b) => a.switchNumber! - b.switchNumber!);
  assertAnchors(await badges(page), tracks);
  const baseline = await mechanisms(page);
  expect(baseline).toHaveLength(switches.length);
  for (const track of switches) {
    const before = await mechanisms(page);
    const beforeBadges = await badges(page);
    const control = desk(page).getByRole('button', { name: `Switch ${track.switchNumber} branch`, exact: true });
    await control.click();
    await page.clock.fastForward(400);
    await expect(control).toHaveAttribute('aria-pressed', 'true');
    assertOnlyPointMoved(before, await mechanisms(page), track.id);
    const afterBadges = await badges(page);
    for (const original of beforeBadges) {
      const current = afterBadges.find(badge => badge.id === original.id)!;
      expect(current.number).toBe(original.number);
      expect(current.position).toEqual(original.position);
      expect(current.anchor).toEqual(original.anchor);
      expect(current.state).toBe(original.id === track.id ? 'branch' : original.state);
    }
  }
  assertAnchors(await badges(page), (await saved(page)).tracks);
  // Return all routes, then let one rendered clock window settle every blade.
  // Pointer access was exercised for every row above. Restore via those same
  // controls without a second full scroll of the 24-row desk on software WebGL.
  for (const track of switches) await desk(page).getByRole('button', { name: `Switch ${track.switchNumber} straight`, exact: true })
    .evaluate(button => (button as HTMLButtonElement).click());
  await page.clock.fastForward(400);
  expect(await mechanisms(page)).toEqual(baseline);
  assertAnchors(await badges(page), tracks);
}

test('all 24 KATO crossing-plan labels point to their own turnout and every numbered control moves only that turnout', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const layout = clearTrains(makeKatoPlan06());
  await start(page, layout);
  const rendered = await badges(page);
  const one = rendered.find(badge => badge.number === 1)!;
  const four = rendered.find(badge => badge.number === 4)!;
  expect(one.id).not.toBe(four.id);
  expect(Math.hypot(one.anchor.x - four.anchor.x, one.anchor.y - four.anchor.y)).toBeGreaterThan(30);
  await checkEveryControl(page, layout.tracks);
  await scene(page).screenshot({ path: info.outputPath('kato-all-24-turnout-labels.png') });
  await page.getByRole('button', { name: 'Top view', exact: true }).click();
  await page.clock.fastForward(16);
  assertAnchors(await badges(page), layout.tracks);
  await scene(page).screenshot({ path: info.outputPath('kato-all-24-top-view.png') });
  expect((await saved(page)).tracks).toEqual(layout.tracks);
  expect(errors).toEqual([]);
});

test('both M1 + V1 + V2 numbered labels remain attached to the correct rendered points', async ({ page }, info) => {
  const layout = clearTrains(makeKatoPlan02());
  await start(page, layout);
  await checkEveryControl(page, layout.tracks);
  await scene(page).screenshot({ path: info.outputPath('m1-v1-v2-turnout-labels.png') });
});

function catalogFixture(): LayoutData {
  const kinds = ['t4l', 't4r', 't6l', 't6r', 'scissors'];
  const tracks: Track[] = kinds.flatMap((kind, index) => [-1, 1].map((bend, side) => ({
    id: `label-${kind}-${bend}`, kind, x: index % 3 * 550 - 650, y: Math.floor(index / 3) * 950 + side * 400 - 600,
    angle: (index + side * 2) * Math.PI / 4, bend: bend as -1 | 1, elevation: side ? 60 : 0, endElevation: side ? 60 : 0,
    switchNumber: 20 - index * 3 - side, switchState: 'straight' as const,
  })));
  return { version: 5, name: 'Rotated and elevated switch labels', tracks: tracks.reverse(), accessories: [], trainType: 'e235', carCount: 3, trains: [], couplings: [] };
}

test('every catalog turnout and scissors variant keeps its identity through mirrored placement, rotation, import, undo and reload', async ({ page }, info) => {
  const layout = catalogFixture();
  await start(page, layout);
  await checkEveryControl(page, layout.tracks);
  const initial = await badges(page);
  const target = layout.tracks.find(track => track.kind === 't4l' && track.bend === -1)!;
  await desk(page).getByRole('button', { name: `Show switch ${target.switchNumber}`, exact: true }).click();
  await editSelectedPiece(page);
  await page.getByRole('button', { name: 'Rotate selected piece', exact: true }).click();
  await page.clock.fastForward(200);
  assertAnchors(await badges(page), (await saved(page)).tracks);
  expect((await badges(page)).find(badge => badge.id === target.id)!.number).toBe(target.switchNumber);
  await page.getByRole('button', { name: 'Undo last change', exact: true }).click();
  await page.clock.fastForward(200);
  assertAnchors(await badges(page), layout.tracks);
  expect((await badges(page)).map(badge => [badge.id, badge.number, badge.anchor]).sort()).toEqual(initial.map(badge => [badge.id, badge.number, badge.anchor]).sort());
  const reordered = { ...layout, tracks: [...layout.tracks].reverse() };
  await page.locator('input[type="file"]').setInputFiles({
    name: 'reordered-switch-labels.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(reordered)),
  });
  await page.clock.fastForward(200);
  await expect.poll(async () => (await saved(page)).tracks[0].id).toBe(reordered.tracks[0].id);
  assertAnchors(await badges(page), reordered.tracks);
  expect((await badges(page)).map(badge => [badge.id, badge.number, badge.anchor]).sort()).toEqual(initial.map(badge => [badge.id, badge.number, badge.anchor]).sort());
  await page.getByRole('button', { name: 'Undo last change', exact: true }).click();
  await page.clock.fastForward(200);
  expect((await saved(page)).tracks).toEqual(layout.tracks);
  await page.reload();
  await expect(scene(page)).toHaveAttribute('data-ready', 'true');
  await openSwitchDesk(page);
  await page.clock.fastForward(200);
  assertAnchors(await badges(page), layout.tracks);
  await scene(page).screenshot({ path: info.outputPath('catalog-mirrored-rotated-elevated-switches.png') });
});

test('the reported adjacent 1 and 4 pair has clearly attached labels in close perspective and top views', async ({ page }, info) => {
  const complete = clearTrains(makeKatoPlan06());
  const pair = complete.tracks.filter(track => track.switchNumber === 1 || track.switchNumber === 4);
  // Keep the original positions and geometry, with a tighter camera fit for
  // visually checking the two neighboring mechanisms and their stems.
  const tracks = pair;
  const layout = { ...complete, name: 'Close view of the original turnout 1 and 4 pair', tracks, accessories: [] };
  expect(tracks.filter(track => track.switchNumber).map(track => track.switchNumber).sort()).toEqual([1, 4]);
  await start(page, layout);
  assertAnchors(await badges(page), tracks);
  await page.clock.runFor(100);
  await scene(page).screenshot({ path: info.outputPath('adjacent-1-and-4-perspective.png') });
  await checkEveryControl(page, tracks);
  await page.getByRole('button', { name: 'Top view', exact: true }).click();
  await page.clock.runFor(200);
  assertAnchors(await badges(page), tracks);
  await scene(page).screenshot({ path: info.outputPath('adjacent-1-and-4-top.png') });
});
