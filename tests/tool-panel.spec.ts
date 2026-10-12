import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { parseLayout } from '../src/layout';
import type { LayoutData } from '../src/layout';
import { makeStarterLayout } from '../src/track';
import { editSelectedPiece, openMoreTools, showPieces } from './builder-navigation';

// Small, idle scenes exercise the actual UI and helper worker with software WebGL.
test.setTimeout(180_000);
const STORAGE_KEY = 'little-railways-layout-v5';
const scene = (page: Page) => page.getByRole('img', {
  name: '3D railway layout: rotate, zoom, select trains, and move Kato track pieces',
});
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });
const pane = (page: Page, name: string) => page.getByRole('tabpanel', { name, exact: true });
const helper = (page: Page) => page.getByRole('region', { name: 'Track helper', exact: true });
const helperActions = (page: Page) => pane(page, 'Helper').locator('.builder-actions');

function fixture(unfinished = false): LayoutData {
  return parseLayout({
    version: 5, name: 'Our tool-panel railway', carCount: 3, trainType: 'e235', trains: [], couplings: [],
    tracks: unfinished ? makeStarterLayout('oval').slice(2) : [],
    accessories: unfinished ? [{
      id: 'panel-platform', kind: 'a-platform', x: 0, y: 200, angle: 0, elevation: 0,
      stationName: 'Our station',
    }] : [],
  });
}

async function start(page: Page, value = fixture()) {
  const time = new Date('2026-10-12T00:00:00Z');
  await page.clock.install({ time: new Date(time.getTime() - 60_000) });
  await page.clock.pauseAt(time);
  await page.addInitScript(({ key, value }) => {
    if (sessionStorage.getItem('tool-panel-fixture')) return;
    localStorage.setItem(key, JSON.stringify(value));
    localStorage.setItem('little-railways-saved-designs-v1', JSON.stringify({ version: 1, designs: [] }));
    sessionStorage.setItem('tool-panel-fixture', 'installed');
  }, { key: STORAGE_KEY, value });
  await page.goto('./');
  await expect(scene(page)).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await page.clock.fastForward(16);
}

async function current(page: Page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY) as Promise<LayoutData>;
}

async function preview(page: Page) {
  return scene(page).evaluate(element => JSON.parse((element as HTMLCanvasElement).dataset.trackHelperPreview ?? 'null'));
}

async function checkFinish(page: Page) {
  await tab(page, 'Helper').click();
  await helperActions(page).getByRole('button', { name: 'Check feasibility', exact: true }).click();
  await expect(helper(page).getByText('We found a finish using 2 pieces!', { exact: true })).toBeVisible({ timeout: 120_000 });
  await page.clock.fastForward(16);
}

async function expectSplitInViewport(page: Page) {
  console.log('[tool-panel-viewport]', JSON.stringify(await page.evaluate(() => {
    const panel = document.querySelector('.builder-panel')!;
    const visiblePane = [...panel.querySelectorAll<HTMLElement>('.builder-pane')].find(element => !element.hidden)!;
    const height = (selector: string) => panel.querySelector(selector)?.getBoundingClientRect().height ?? 0;
    return {
      viewport: [innerWidth, innerHeight], tool: visiblePane.id,
      canvasHeight: document.querySelector('canvas')!.getBoundingClientRect().height,
      railwayHeights: Object.fromEntries(['.railway-card', '.board-header', '.layout-plan-info', '.cockpit-fleet', '.cockpit-drive-dock'].map(selector => [selector, document.querySelector(selector)?.getBoundingClientRect().height ?? 0])),
      chromeStyles: Object.fromEntries(['.app-header', '.board-header'].map(selector => { const element = document.querySelector(selector)!; const style = getComputedStyle(element); return [selector, { height: element.getBoundingClientRect().height, minHeight: style.minHeight, flexBasis: style.flexBasis, padding: style.padding }]; })),
      desktopHeaderMedia: matchMedia('(min-width: 761px)').matches,
      panelHeight: panel.getBoundingClientRect().height, headerHeight: height('.builder-header'),
      tabsHeight: height('.builder-tabs'), selectedHeight: height('.builder-selected-strip'),
      scrollHeight: visiblePane.querySelector('.builder-scroll')!.getBoundingClientRect().height,
      actionsHeight: visiblePane.querySelector('.builder-actions')?.getBoundingClientRect().height ?? 0,
      pageHeight: document.documentElement.scrollHeight,
    };
  })));
  const canvas = await scene(page).boundingBox();
  const tools = await page.locator('.builder-panel').boundingBox();
  const height = page.viewportSize()!.height;
  expect(canvas!.height).toBeGreaterThan(120);
  expect(canvas!.y).toBeGreaterThanOrEqual(0);
  expect(canvas!.y + canvas!.height).toBeLessThanOrEqual(height + 1);
  expect(tools!.y).toBeGreaterThanOrEqual(0);
  expect(tools!.y + tools!.height).toBeLessThanOrEqual(height + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
}

test('desktop tabs preserve catalog and ramp choices, support keyboard selection, and scroll tools independently', async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await start(page);
  await expect(tab(page, 'Pieces')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tablist', { name: 'Building tools', exact: true }).getByRole('tab')).toHaveCount(3);
  await page.getByRole('button', { name: 'Curves', exact: true }).click();
  await page.getByRole('button', { name: 'Bend left', exact: true }).click();
  await page.getByRole('combobox', { name: 'New piece height', exact: true }).selectOption('40');
  const before = await current(page);
  const canvasBefore = await scene(page).boundingBox();
  const scroll = pane(page, 'Pieces').locator('.builder-scroll');
  await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
  const oldScroll = await scroll.evaluate(element => element.scrollTop);
  expect(oldScroll).toBeGreaterThan(0);
  const box = await scroll.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.wheel(0, 1500);
  await expectSplitInViewport(page);
  expect(await scene(page).boundingBox()).toEqual(canvasBefore);
  await tab(page, 'Pieces').focus();
  await page.keyboard.press('ArrowRight');
  await expect(tab(page, 'Ramp')).toBeFocused();
  await expect(tab(page, 'Ramp')).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('combobox', { name: 'Ramp target height', exact: true }).selectOption('80');
  await page.getByRole('combobox', { name: 'Ramp maximum grade', exact: true }).selectOption('2.5');
  await tab(page, 'Ramp').focus();
  await page.keyboard.press('End');
  await expect(tab(page, 'Helper')).toBeFocused();
  await expect(helper(page).getByRole('combobox', { name: 'First track end', exact: true })).toBeVisible();
  await expect(helperActions(page).getByRole('button', { name: 'Check feasibility', exact: true })).toBeDisabled();
  await page.keyboard.press('Home');
  await expect(tab(page, 'Pieces')).toBeFocused();
  await expect(page.getByRole('button', { name: 'Curves', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Bend left', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('combobox', { name: 'New piece height', exact: true })).toHaveValue('40');
  expect(await scroll.evaluate(element => element.scrollTop)).toBe(oldScroll);
  await page.getByRole('searchbox', { name: 'Search Kato catalog', exact: true }).fill('20-220');
  await tab(page, 'Ramp').click();
  await expect(page.getByRole('combobox', { name: 'Ramp target height', exact: true })).toHaveValue('80');
  await expect(page.getByRole('combobox', { name: 'Ramp maximum grade', exact: true })).toHaveValue('2.5');
  await showPieces(page);
  await expect(page.getByRole('searchbox', { name: 'Search Kato catalog', exact: true })).toHaveValue('20-220');
  await expect(page.getByRole('button', { name: 'Add #4 left turnout', exact: true })).toBeVisible();
  expect(await current(page), 'Changing tools only changes UI state').toEqual(before);
  expect(errors).toEqual([]);
  await page.clock.runFor(100);
  await page.screenshot({ path: info.outputPath('desktop-tool-tabs.png') });
});

test('a long helper suggestion keeps its actions and railway visible and survives tab changes without saving a preview', async ({ page }, info) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await start(page, fixture(true));
  const before = await current(page);
  await checkFinish(page);
  const firstEnd = await helper(page).getByRole('combobox', { name: 'First track end', exact: true }).inputValue();
  const secondEnd = await helper(page).getByRole('combobox', { name: 'Second track end', exact: true }).inputValue();
  expect((await preview(page)).ghostCount).toBe(2);
  await helper(page).locator('details.track-helper-scope > summary').click();
  const canvasBefore = await scene(page).boundingBox();
  const scroll = pane(page, 'Helper').locator('.builder-scroll');
  await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
  expect(await scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  const add = helperActions(page).getByRole('button', { name: 'Add these pieces', exact: true });
  await expect(add).toBeVisible();
  const actionBox = await add.boundingBox();
  expect(actionBox!.y + actionBox!.height).toBeLessThanOrEqual(700);
  await expectSplitInViewport(page);
  expect(await scene(page).boundingBox()).toEqual(canvasBefore);
  await tab(page, 'Pieces').click();
  await page.clock.fastForward(16);
  expect(await preview(page)).toBeNull();
  expect(await current(page)).toEqual(before);
  await tab(page, 'Helper').click();
  await page.clock.fastForward(16);
  await expect(helper(page).getByRole('combobox', { name: 'First track end', exact: true })).toHaveValue(firstEnd);
  await expect(helper(page).getByRole('combobox', { name: 'Second track end', exact: true })).toHaveValue(secondEnd);
  await expect(add).toBeEnabled();
  expect((await preview(page)).ghostCount).toBe(2);
  expect(await current(page)).toEqual(before);
  await page.clock.runFor(100);
  await page.screenshot({ path: info.outputPath('helper-fixed-actions.png') });
  await add.click();
  expect((await current(page)).tracks).toHaveLength(before.tracks.length + 2);
  await page.getByRole('button', { name: 'Undo last change', exact: true }).click();
  expect(await current(page)).toEqual(before);
});

test('scene selection leaves Helper active; the explicit editor preserves drafts and invalidates suggestions on a station edit', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await start(page, fixture(true));
  await page.getByRole('button', { name: 'Top view', exact: true }).click();
  await page.clock.fastForward(500);
  await checkFinish(page);
  const before = await current(page);
  const point = await scene(page).evaluate(element => {
    const point = JSON.parse((element as HTMLCanvasElement).dataset.pickPoints!)['panel-platform'];
    const box = element.getBoundingClientRect();
    return { x: box.x + point.x, y: box.y + point.y };
  });
  await page.mouse.click(point.x, point.y);
  await expect(page.getByRole('button', { name: 'Edit selected piece', exact: true })).toBeVisible();
  await expect(tab(page, 'Helper')).toHaveAttribute('aria-selected', 'true');
  await expect(helperActions(page).getByRole('button', { name: 'Add these pieces', exact: true })).toBeEnabled();
  await editSelectedPiece(page);
  const name = page.getByRole('textbox', { name: 'Station name', exact: true });
  await name.fill('こども駅 · Our station');
  await page.getByRole('button', { name: 'Back to tools', exact: true }).click();
  await expect(tab(page, 'Helper')).toHaveAttribute('aria-selected', 'true');
  await page.clock.fastForward(16);
  expect((await preview(page)).ghostCount).toBe(2);
  expect(await current(page)).toEqual(before);
  await editSelectedPiece(page);
  await expect(name).toHaveValue('こども駅 · Our station');
  await page.getByRole('button', { name: 'Apply station name', exact: true }).click();
  expect((await current(page)).accessories[0].stationName).toBe('こども駅 · Our station');
  await page.getByRole('button', { name: 'Back to tools', exact: true }).click();
  await expect(helperActions(page).getByRole('button', { name: 'Add these pieces', exact: true })).toHaveCount(0);
  await expect(helperActions(page).getByRole('button', { name: 'Check feasibility', exact: true })).toBeEnabled();
  await page.clock.fastForward(16);
  expect((await preview(page)).ghostCount).toBe(0);
  await page.getByRole('button', { name: 'Undo last change', exact: true }).click();
  expect(await current(page)).toEqual(before);
});

test('Ramp has an accessible fixed build action and existing placed-piece management remains reachable', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await start(page);
  const before = await current(page);
  await tab(page, 'Ramp').click();
  await page.getByRole('combobox', { name: 'Ramp target height', exact: true }).selectOption('20');
  const build = pane(page, 'Ramp').locator('.builder-actions').getByRole('button', { name: 'Build ramp', exact: true });
  await expect(build).toBeEnabled();
  const box = await build.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(720);
  await build.click();
  const built = await current(page);
  expect(built.tracks.length).toBeGreaterThan(1);
  expect(built.tracks.at(-1)!.endElevation).toBe(20);
  await page.getByRole('button', { name: 'Undo last change', exact: true }).click();
  expect(await current(page)).toEqual(before);
  await openMoreTools(page);
  await expect(page.getByRole('button', { name: 'Check before shopping', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save a layout file', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Catalog & model references', exact: true })).toBeVisible();
});

for (const viewport of [{ width: 800, height: 900 }, { width: 390, height: 844 }]) {
  test(`split view keeps the railway and tools visible at ${viewport.width}px, with an optional expanded tool area`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await start(page, fixture(true));
    await openMoreTools(page);
    await page.locator('details.inventory > summary').click();
    await page.getByRole('button', { name: 'Select placed Modern DX island platform A · 248 mm', exact: true }).click();
    await tab(page, 'Helper').click();
    await expect(page.getByRole('button', { name: 'Edit selected piece', exact: true })).toBeVisible();
    await expectSplitInViewport(page);
    const canvasBefore = await scene(page).boundingBox();
    const expand = page.getByRole('button', { name: 'Expand tools', exact: true });
    await expect(expand).toBeVisible();
    await expand.click();
    await expect(page.locator('.workspace')).toHaveClass(/tool-panel-expanded/);
    await expectSplitInViewport(page);
    expect((await scene(page).boundingBox())!.height).toBeLessThan(canvasBefore!.height);
    await page.getByRole('button', { name: 'Shrink tools', exact: true }).click();
    await expect(page.locator('.workspace')).not.toHaveClass(/tool-panel-expanded/);
    await expectSplitInViewport(page);
    await helperActions(page).getByRole('button', { name: 'Check feasibility', exact: true }).click();
    await expect(helperActions(page).getByRole('button', { name: 'Add these pieces', exact: true })).toBeEnabled({ timeout: 120_000 });
    const actionBox = await helperActions(page).getByRole('button', { name: 'Add these pieces', exact: true }).boundingBox();
    expect(actionBox!.y + actionBox!.height).toBeLessThanOrEqual(viewport.height);
    await expectSplitInViewport(page);
    expect(await pane(page, 'Helper').locator('.builder-scroll').evaluate(element => element.clientHeight)).toBeGreaterThanOrEqual(viewport.width === 390 ? 80 : 100);
    await page.clock.runFor(100);
    await page.screenshot({ path: info.outputPath(`split-view-${viewport.width}.png`) });
    await page.getByRole('button', { name: 'Expand tools', exact: true }).click();
    await expectSplitInViewport(page);
    expect(await pane(page, 'Helper').locator('.builder-scroll').evaluate(element => element.clientHeight)).toBeGreaterThanOrEqual(viewport.width === 390 ? 120 : 100);
    await page.clock.runFor(100);
    await page.screenshot({ path: info.outputPath(`split-view-expanded-${viewport.width}.png`) });
  });
}

test('catalog drag-to-place still works after switching tools and the explicit editor changes a selected track', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await start(page);
  await tab(page, 'Helper').click();
  await showPieces(page);
  const canvas = scene(page);
  const bounds = (await canvas.boundingBox())!;
  await page.getByRole('button', { name: 'Add 248 mm straight', exact: true }).dragTo(canvas, {
    targetPosition: { x: bounds.width * .55, y: bounds.height * .55 },
  });
  expect((await current(page)).tracks).toHaveLength(1);
  await expect(tab(page, 'Pieces')).toHaveAttribute('aria-selected', 'true');
  await editSelectedPiece(page);
  await page.getByRole('button', { name: 'Rotate selected piece', exact: true }).click();
  expect((await current(page)).tracks[0].angle).toBeCloseTo(Math.PI / 4);
  await page.getByRole('button', { name: 'Back to tools', exact: true }).click();
  await expect(tab(page, 'Pieces')).toHaveAttribute('aria-selected', 'true');
  await expectSplitInViewport(page);
});

test('the KATO M1 preset retains a usable railway with the helper and selection strip on phone and landscape screens', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  await page.getByRole('button', { name: 'Layouts', exact: true }).click();
  const chooser = page.getByRole('dialog', { name: 'Where shall we go?', exact: true });
  await chooser.getByRole('combobox', { name: 'Choose a layout', exact: true }).selectOption('preset:kato-plan02');
  await chooser.getByRole('button', { name: 'Open layout', exact: true }).click();
  await page.clock.fastForward(16);
  await openMoreTools(page);
  await page.locator('details.inventory > summary').click();
  await page.getByRole('button', { name: 'Select placed 248 mm straight', exact: true }).first().click();
  await tab(page, 'Helper').click();
  await expectSplitInViewport(page);
  expect(await pane(page, 'Helper').locator('.builder-scroll').evaluate(element => element.clientHeight)).toBeGreaterThanOrEqual(80);
  await expect(helperActions(page).getByRole('button', { name: 'Check feasibility', exact: true })).toBeVisible();
  await page.clock.runFor(100);
  await page.screenshot({ path: info.outputPath('phone-kato-selected-helper.png') });
  await page.getByRole('button', { name: 'Expand tools', exact: true }).click();
  await page.clock.fastForward(16);
  await expectSplitInViewport(page);
  expect(await pane(page, 'Helper').locator('.builder-scroll').evaluate(element => element.clientHeight)).toBeGreaterThanOrEqual(120);
  await page.clock.runFor(100);
  await page.screenshot({ path: info.outputPath('phone-kato-selected-helper-expanded.png') });
  await page.getByRole('button', { name: 'Shrink tools', exact: true }).click();
  await page.setViewportSize({ width: 844, height: 390 });
  await page.clock.fastForward(16);
  await expectSplitInViewport(page);
  await expect(page.getByRole('button', { name: 'Expand tools', exact: true })).toBeHidden();
  await expect(helperActions(page).getByRole('button', { name: 'Check feasibility', exact: true })).toBeVisible();
  const planLink = page.locator('.layout-plan-info').getByRole('link', { name: 'View KATO plan', exact: true });
  await planLink.scrollIntoViewIfNeeded();
  await planLink.focus();
  await expect(planLink).toBeFocused();
  const driveRow = page.locator('.cockpit-drive-dock');
  await page.getByRole('button', { name: 'Couple trains', exact: true }).scrollIntoViewIfNeeded();
  const couplingButton = await page.getByRole('button', { name: 'Couple trains', exact: true }).boundingBox();
  const dockBox = await driveRow.boundingBox();
  expect(couplingButton!.x).toBeGreaterThanOrEqual(dockBox!.x);
  expect(couplingButton!.x + couplingButton!.width).toBeLessThanOrEqual(dockBox!.x + dockBox!.width + 1);
  await page.getByRole('button', { name: 'Run train', exact: true }).scrollIntoViewIfNeeded();
  await expectSplitInViewport(page);
  await page.clock.runFor(100);
  await page.screenshot({ path: info.outputPath('landscape-kato-selected-helper.png') });
});
