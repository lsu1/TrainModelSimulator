import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { parseLayout } from '../src/layout';
import type { LayoutData } from '../src/layout';
import { connectedEndpoint, makeStarterLayout, openEndpoints } from '../src/track';
import type { Track } from '../src/track';

// Exercise the real background worker and existing save/undo pipeline, with
// animation idle so software WebGL does not dominate an interaction test.
test.setTimeout(180_000);
const STORAGE_KEY = 'little-railways-layout-v5';
const LIBRARY_KEY = 'little-railways-saved-designs-v1';
const scene = (page: Page) => page.getByRole('img', {
  name: '3D railway layout: rotate, zoom, select trains, and move Kato track pieces',
});
const helper = (page: Page) => page.getByRole('region', { name: 'Track helper', exact: true });
const first = (page: Page) => helper(page).getByRole('combobox', { name: 'First track end', exact: true });
const second = (page: Page) => helper(page).getByRole('combobox', { name: 'Second track end', exact: true });
const check = (page: Page) => helper(page).getByRole('button', { name: 'Check feasibility', exact: true });
const endValue = (trackId: string, end: number) => JSON.stringify([trackId, end]);

function layout(tracks: Track[], name = 'Our unfinished railway'): LayoutData {
  return parseLayout({
    version: 5, name, carCount: 3, trainType: 'e235', trains: [], couplings: [], tracks,
    accessories: [{ id: 'helper-platform', kind: 'a-platform', x: 0, y: 0, angle: 0, elevation: 0, stationName: 'こども駅 · Our station' }],
  });
}

function unfinishedOval(missing = 2): LayoutData {
  return layout(makeStarterLayout('oval').slice(missing));
}

function straight(id: string, x: number, y = 0, height = 0): Track {
  return { id, kind: 's248', x, y, angle: 0, bend: 1, elevation: height, endElevation: height };
}

async function start(page: Page, value: LayoutData, saved = false) {
  const time = new Date('2026-10-12T00:00:00Z');
  await page.clock.install({ time });
  await page.clock.pauseAt(time);
  await page.addInitScript(({ value, saved }) => {
    if (sessionStorage.getItem('track-helper-fixture')) return;
    localStorage.setItem('little-railways-layout-v5', JSON.stringify({
      ...value, ...(saved ? { savedDesignId: 'helper-snapshot' } : {}),
    }));
    localStorage.setItem('little-railways-saved-designs-v1', JSON.stringify({ version: 1, designs: saved ? [{
      id: 'helper-snapshot', name: value.name, updatedAt: '2026-10-12T00:00:00Z', layout: value,
    }] : [] }));
    sessionStorage.setItem('track-helper-fixture', 'installed');
  }, { value, saved });
  await page.goto('./');
  await expect(scene(page)).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await page.clock.fastForward(16);
}

async function current(page: Page): Promise<LayoutData & { savedDesignId?: string }> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY);
}

async function library(page: Page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), LIBRARY_KEY);
}

async function preview(page: Page): Promise<{
  ghostCount: number; ghostIds: string[]; removeIds: string[];
  ends: { trackId: string; end: number; label: string }[];
} | null> {
  return scene(page).evaluate(element => JSON.parse((element as HTMLCanvasElement).dataset.trackHelperPreview ?? 'null'));
}

async function expand(page: Page) {
  const toggle = helper(page).getByRole('button', { name: 'Track helper', exact: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(first(page)).toBeVisible();
}

async function chooseEnds(page: Page, a: [string, number], b: [string, number]) {
  await first(page).selectOption(endValue(...a));
  await second(page).selectOption(endValue(...b));
}

test('real worker previews a loop finish without changing the design, applies it once and restores it with Undo', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const fixture = unfinishedOval();
  expect(openEndpoints(fixture.tracks)).toHaveLength(2);
  await start(page, fixture, true);
  const before = await current(page);
  const savedBefore = await library(page);
  await expect(helper(page).getByRole('button', { name: 'Track helper', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expand(page);
  await expect(first(page)).not.toHaveValue('');
  await expect(second(page)).not.toHaveValue('');
  expect((await preview(page))?.ends.map(end => end.label)).toEqual(['A', 'B']);
  expect((await preview(page))?.ghostCount).toBe(0);
  await expect(check(page)).toBeEnabled();
  await check(page).click();
  await expect(helper(page).getByText('We found a finish using 2 pieces!', { exact: true })).toBeVisible({ timeout: 120_000 });
  await expect(helper(page).getByText('This joins the selected ends and completes a track circuit.', { exact: false })).toBeVisible();
  await expect(helper(page).getByRole('button', { name: 'Add these pieces', exact: true })).toBeEnabled();
  expect(await current(page), 'Suggestions are only previews until accepted').toEqual(before);
  expect(await library(page), 'A suggestion does not overwrite a named snapshot').toEqual(savedBefore);
  expect((await preview(page))?.ghostCount).toBe(2);
  expect((await preview(page))?.removeIds).toEqual([]);
  await page.clock.fastForward(16);
  const previewImage = info.outputPath('loop-finishing-preview.png');
  await helper(page).screenshot({ path: previewImage });
  await info.attach('loop-finishing-preview', { path: previewImage, contentType: 'image/png' });
  const scenePreview = info.outputPath('loop-finishing-scene.png');
  await scene(page).screenshot({ path: scenePreview });
  await info.attach('loop-finishing-scene', { path: scenePreview, contentType: 'image/png' });
  await helper(page).getByRole('button', { name: 'Add these pieces', exact: true }).click();
  await page.clock.fastForward(16);
  const completed = await current(page);
  expect(completed.tracks).toHaveLength(12);
  expect(completed.tracks.slice(0, before.tracks.length)).toEqual(before.tracks);
  expect(openEndpoints(completed.tracks)).toEqual([]);
  for (const track of completed.tracks) {
    expect(connectedEndpoint(completed.tracks, track.id, 0)).not.toBeNull();
    expect(connectedEndpoint(completed.tracks, track.id, 1)).not.toBeNull();
  }
  expect(completed.accessories).toEqual(before.accessories);
  expect(completed.trains).toEqual(before.trains);
  expect(completed.couplings).toEqual(before.couplings);
  expect(completed.savedDesignId).toBe(before.savedDesignId);
  expect(await library(page)).toEqual(savedBefore);
  await expect(helper(page).getByRole('button', { name: 'Add these pieces', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo last change', exact: true }).click();
  await page.clock.fastForward(16);
  expect(await current(page), 'The entire finishing section is a single undo step').toEqual(before);
  await check(page).click();
  await expect(helper(page).getByRole('button', { name: 'Add these pieces', exact: true })).toBeVisible({ timeout: 120_000 });
  await helper(page).getByRole('button', { name: 'Add these pieces', exact: true }).click();
  await page.clock.fastForward(16);
  const persisted = await current(page);
  await page.reload();
  await expect(scene(page)).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await page.clock.fastForward(16);
  const reloaded = await current(page);
  expect(parseLayout(reloaded)).toEqual(parseLayout(persisted));
  expect(reloaded.savedDesignId).toBe(persisted.savedDesignId);
  expect(await library(page)).toEqual(savedBefore);
  expect(errors).toEqual([]);
});

test('multiple open ends require a selected pair and show distance and height guidance before checking', async ({ page }) => {
  await start(page, layout([
    straight('left', 0), straight('right', 496), straight('far', 2600), straight('raised', 496, 250, 60),
  ]));
  const before = await current(page);
  await expand(page);
  await expect(first(page)).toHaveValue('');
  await expect(second(page)).toHaveValue('');
  await expect(check(page)).toBeDisabled();
  await chooseEnds(page, ['left', 1], ['far', 0]);
  await expect(check(page)).toBeDisabled();
  await expect(helper(page)).toContainText(/within 1,?500 mm before checking/);
  await chooseEnds(page, ['left', 1], ['raised', 0]);
  await expect(check(page)).toBeDisabled();
  await expect(helper(page)).toContainText('Height difference: 60.0 mm');
  await chooseEnds(page, ['left', 1], ['right', 0]);
  await expect(check(page)).toBeEnabled();
  await expect(first(page).locator(`option[value='${endValue('right', 0)}']`)).toBeDisabled();
  await check(page).click();
  await expect(helper(page).getByRole('button', { name: 'Add these pieces', exact: true })).toBeVisible({ timeout: 120_000 });
  expect(await current(page)).toEqual(before);
  await second(page).selectOption(endValue('raised', 0));
  await expect(helper(page).getByRole('button', { name: 'Add these pieces', exact: true })).toHaveCount(0);
  await expect(check(page)).toBeDisabled();
  expect(await current(page)).toEqual(before);
});

test('opening another layout discards the checked suggestion and preserves the existing preset chooser', async ({ page }) => {
  await start(page, unfinishedOval(1));
  await expand(page);
  await check(page).click();
  await expect(helper(page).getByRole('button', { name: 'Add these pieces', exact: true })).toBeVisible({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Layouts', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Where shall we go?', exact: true });
  const chooser = dialog.getByRole('combobox', { name: 'Choose a layout', exact: true });
  await expect(chooser.locator('optgroup[label="Sample layouts"] option')).toHaveCount(6);
  await expect(chooser.locator('option[value="preset:kato-plan02"]')).toHaveText('KATO M1 + V1 + V2');
  await expect(chooser.locator('option[value="preset:kato-plan06-15"]')).toHaveText('新干线与在来线交错运行');
  await chooser.selectOption('preset:empty');
  await dialog.getByRole('button', { name: 'Open layout', exact: true }).click();
  await page.clock.fastForward(16);
  expect((await current(page)).tracks).toEqual([]);
  await expect(helper(page).getByRole('button', { name: 'Add these pieces', exact: true })).toHaveCount(0);
  await expect(check(page)).toBeDisabled();
  await expect(first(page)).toHaveValue('');
  await expect(second(page)).toHaveValue('');
  await page.getByRole('button', { name: 'Undo last change', exact: true }).click();
  await page.clock.fastForward(16);
  expect((await current(page)).tracks).toHaveLength(11);
  await expect(check(page)).toBeEnabled();
  await expect(helper(page).getByRole('button', { name: 'Add these pieces', exact: true })).toHaveCount(0);
});

test('a completed no-fit check gives direction clues and stays repeatable without changing the railway', async ({ page }) => {
  await start(page, layout([
    straight('first-island', 0), { ...straight('second-island', 600, 100), angle: Math.PI / 36 },
  ]));
  const before = await current(page);
  await expand(page);
  await chooseEnds(page, ['first-island', 1], ['second-island', 0]);
  await expect(helper(page)).toContainText('Direction mismatch: 5.0°');
  await check(page).click();
  await expect(helper(page).getByText('No finish found within these limits.', { exact: true })).toBeVisible({ timeout: 120_000 });
  await expect(helper(page)).toContainText('six added pieces and three removed end pieces');
  await expect(helper(page)).toContainText('Try changing a nearby curve or straight');
  await expect(helper(page)).toContainText('Different directions can still be connected with curves.');
  await expect(helper(page).getByRole('button', { name: 'Add these pieces', exact: true })).toHaveCount(0);
  const firstResult = await helper(page).locator('.track-helper-result').innerText();
  expect(await current(page)).toEqual(before);
  await check(page).click();
  await expect(helper(page).getByText('No finish found within these limits.', { exact: true })).toBeVisible({ timeout: 120_000 });
  expect(await helper(page).locator('.track-helper-result').innerText()).toBe(firstResult);
  expect(await current(page)).toEqual(before);
});

test('an actual exhausted worker budget gives honest limits and actionable clues rather than declaring the railway impossible', async ({ page }) => {
  const fixture = layout([
    { ...straight('a-back', -124), kind: 's62' }, { ...straight('a', -62), kind: 's62' },
    { ...straight('b', 200, .4), kind: 's62' }, { ...straight('b-back', 262, .4), kind: 's62' },
  ]);
  fixture.accessories[0].y = 200;
  await start(page, fixture);
  const before = await current(page);
  await expand(page);
  await chooseEnds(page, ['a', 1], ['b', 0]);
  await check(page).click();
  await expect(helper(page).getByText('We reached the search limit.', { exact: true })).toBeVisible({ timeout: 120_000 });
  await expect(helper(page)).toContainText('We have not found a finish yet.');
  await expect(helper(page)).toContainText('Try a different straight length or curve near one end');
  await expect(helper(page).getByText('No finish found within these limits.', { exact: true })).toHaveCount(0);
  await expect(helper(page).getByRole('button', { name: 'Add these pieces', exact: true })).toHaveCount(0);
  const firstResult = await helper(page).locator('.track-helper-result').innerText();
  expect(await current(page)).toEqual(before);
  await check(page).click();
  await expect(helper(page).getByText('We reached the search limit.', { exact: true })).toBeVisible({ timeout: 120_000 });
  expect(await helper(page).locator('.track-helper-result').innerText()).toBe(firstResult);
  expect(await current(page)).toEqual(before);
});

test('the real worker suggests a concrete small repair, previews what to remove, and applies it as one undo step', async ({ page }, info) => {
  const fixture = layout([
    { ...straight('repair-anchor-a', -62), kind: 's62' },
    { ...straight('awkward-straight', 0), angle: .2 * Math.PI / 180 },
    { ...straight('repair-anchor-b', 496), kind: 's62' },
  ], 'Our railway with one awkward piece');
  fixture.accessories[0].y = 200;
  await start(page, fixture, true);
  const before = await current(page);
  const savedBefore = await library(page);
  await expand(page);
  await chooseEnds(page, ['awkward-straight', 1], ['repair-anchor-b', 0]);
  await check(page).click();
  await expect(helper(page).getByText('A small repair can connect these ends!', { exact: true })).toBeVisible({ timeout: 120_000 });
  await expect(helper(page)).toContainText('Remove these highlighted pieces:');
  await expect(helper(page)).toContainText('Piece 2 · 248 mm straight');
  await expect(helper(page)).toContainText('orange pieces will be removed');
  await expect(helper(page)).toContainText('It may not complete a route around a loop.');
  expect((await preview(page))?.removeIds).toEqual(['awkward-straight']);
  expect((await preview(page))?.ghostCount).toBe(2);
  expect(await current(page), 'Checking and repair previews leave all existing pieces in place').toEqual(before);
  expect(await library(page)).toEqual(savedBefore);
  await page.clock.fastForward(16);
  const screenshot = info.outputPath('verified-repair-preview.png');
  await helper(page).screenshot({ path: screenshot });
  await info.attach('verified-repair-preview', { path: screenshot, contentType: 'image/png' });
  const scenePreview = info.outputPath('verified-repair-scene.png');
  await scene(page).screenshot({ path: scenePreview });
  await info.attach('verified-repair-scene', { path: scenePreview, contentType: 'image/png' });
  await helper(page).getByRole('button', { name: 'Apply suggested repair', exact: true }).click();
  await page.clock.fastForward(16);
  const repaired = await current(page);
  expect(repaired.tracks).toHaveLength(4);
  expect(repaired.tracks.some(track => track.id === 'awkward-straight')).toBe(false);
  expect(repaired.tracks.filter(track => ['repair-anchor-a', 'repair-anchor-b'].includes(track.id))).toEqual(
    before.tracks.filter(track => ['repair-anchor-a', 'repair-anchor-b'].includes(track.id)),
  );
  expect(openEndpoints(repaired.tracks)).toHaveLength(2);
  expect(connectedEndpoint(repaired.tracks, 'repair-anchor-a', 1)).not.toBeNull();
  expect(connectedEndpoint(repaired.tracks, 'repair-anchor-b', 0)).not.toBeNull();
  expect(repaired.accessories).toEqual(before.accessories);
  expect(repaired.savedDesignId).toBe(before.savedDesignId);
  expect(await library(page)).toEqual(savedBefore);
  await page.getByRole('button', { name: 'Undo last change', exact: true }).click();
  await page.clock.fastForward(16);
  expect(await current(page)).toEqual(before);
  expect(await library(page)).toEqual(savedBefore);
});

test('rotating an existing piece clears its old checked preview and Undo does not restore a stale suggestion', async ({ page }) => {
  const fixture = unfinishedOval(1);
  await start(page, fixture);
  await expand(page);
  await check(page).click();
  await expect(helper(page).getByRole('button', { name: 'Add these pieces', exact: true })).toBeVisible({ timeout: 120_000 });
  const before = await current(page);
  expect((await preview(page))?.ghostCount).toBe(1);
  await page.locator('details.inventory > summary').click();
  await page.getByRole('button', { name: 'Select placed 248 mm straight', exact: true }).first().click();
  await page.getByRole('button', { name: 'Rotate selected piece', exact: true }).click();
  await page.clock.fastForward(16);
  const changed = await current(page);
  expect(changed.tracks).not.toEqual(before.tracks);
  await expect(helper(page).getByRole('button', { name: 'Add these pieces', exact: true })).toHaveCount(0);
  expect((await preview(page))?.ghostCount ?? 0).toBe(0);
  await page.getByRole('button', { name: 'Undo last change', exact: true }).click();
  await page.clock.fastForward(16);
  expect(await current(page)).toEqual(before);
  await expect(helper(page).getByRole('button', { name: 'Add these pieces', exact: true })).toHaveCount(0);
  await expect(check(page)).toBeEnabled();
});

test('changing a train model or car count invalidates a preview even when the track geometry is unchanged', async ({ page }) => {
  const fixture = parseLayout({ ...unfinishedOval(1), trainType: 'e5', selectedTrainId: 'our-train', trains: [{
    id: 'our-train', name: 'Our Shinkansen', type: 'e5', carCount: 3,
    position: null, cabForward: true, requestedSpeed: 0,
  }] });
  await start(page, fixture);
  const before = await current(page);
  await expand(page);
  await check(page).click();
  await expect(helper(page).getByRole('button', { name: 'Add these pieces', exact: true })).toBeVisible({ timeout: 120_000 });
  await page.getByRole('combobox', { name: 'Train', exact: true }).selectOption('e6');
  expect((await current(page)).tracks).toEqual(before.tracks);
  expect((await current(page)).trains?.[0].type).toBe('e6');
  await expect(helper(page).getByRole('button', { name: 'Add these pieces', exact: true })).toHaveCount(0);
  expect((await preview(page))?.ghostCount).toBe(0);
  await check(page).click();
  await expect(helper(page).getByRole('button', { name: 'Add these pieces', exact: true })).toBeVisible({ timeout: 120_000 });
  await page.getByRole('combobox', { name: 'Train car count', exact: true }).selectOption('4');
  expect((await current(page)).tracks).toEqual(before.tracks);
  expect((await current(page)).trains?.[0].carCount).toBe(4);
  await expect(helper(page).getByRole('button', { name: 'Add these pieces', exact: true })).toHaveCount(0);
  expect((await preview(page))?.ghostCount).toBe(0);
});

test('the helper fits a phone, supports keyboard navigation and cancels a pending real worker without changing the layout', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page, unfinishedOval());
  const before = await current(page);
  const toggle = helper(page).getByRole('button', { name: 'Track helper', exact: true });
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Tab');
  await expect(first(page)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(second(page)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(check(page)).toBeFocused();

  // Hold only the worker's script request, so cancellation is tested before a
  // fast computer can finish this small search. The app still creates and
  // terminates its real browser Worker; no worker result is mocked.
  let releaseWorker!: () => void;
  const gate = new Promise<void>(resolve => { releaseWorker = resolve; });
  let workerRequested = false;
  await page.route(/trackFeasibility\.worker/, async route => {
    workerRequested = true;
    await gate;
    await route.continue().catch(() => {});
  });
  try {
    await page.keyboard.press('Enter');
    const cancel = helper(page).getByRole('button', { name: 'Cancel check', exact: true });
    await expect(cancel).toBeVisible();
    await expect.poll(() => workerRequested).toBe(true);
    await expect(first(page)).toBeDisabled();
    await expect(second(page)).toBeDisabled();
    await expect(helper(page).getByRole('button', { name: 'Checking your gap…', exact: true })).toBeDisabled();
    await cancel.click();
    await expect(helper(page).getByText('Check cancelled. You can keep building or try again.', { exact: true })).toBeVisible();
    await expect(check(page)).toBeEnabled();
    await expect(first(page)).toBeEnabled();
    await expect(second(page)).toBeEnabled();
    await expect(cancel).toHaveCount(0);
    expect(await current(page)).toEqual(before);
    expect((await preview(page))?.ghostCount).toBe(0);
  } finally {
    releaseWorker();
    await page.unroute(/trackFeasibility\.worker/);
  }
  await check(page).click();
  await expect(helper(page).getByRole('button', { name: 'Add these pieces', exact: true })).toBeVisible({ timeout: 120_000 });
  const bounds = await helper(page).boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391);
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(horizontalOverflow).toBe(false);
  const screenshot = info.outputPath('mobile-track-helper.png');
  await helper(page).screenshot({ path: screenshot });
  await info.attach('mobile-track-helper', { path: screenshot, contentType: 'image/png' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(scene(page)).not.toHaveAttribute('data-track-helper-preview');
  expect(await current(page)).toEqual(before);
});
