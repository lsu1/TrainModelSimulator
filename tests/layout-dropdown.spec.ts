import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { makeCouplingDemo } from '../src/couplingDemo';
import { solveCoupledFormation } from '../src/formationPose';
import { parseLayout } from '../src/layout';
import type { LayoutData } from '../src/layout';
import type { SavedDesign } from '../src/savedDesigns';

// Keep animation idle while exercising the chooser rather than repeatedly
// rendering the unchanged 3D scene in software WebGL.
test.setTimeout(120_000);
const STORAGE_KEY = 'little-railways-layout-v5';
const LIBRARY_KEY = 'little-railways-saved-designs-v1';
const scene = (page: Page) => page.getByRole('img', {
  name: '3D railway layout: rotate, zoom, select trains, and move Kato track pieces',
});
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Where shall we go?', exact: true });
const choice = (page: Page) => dialog(page).getByRole('combobox', { name: 'Choose a layout', exact: true });
const open = (page: Page) => dialog(page).getByRole('button', { name: 'Open layout', exact: true });
const PRESETS = [
  ['kato-plan02', 'KATO M1 + V1 + V2'],
  ['city', 'Tokyo Railway'],
  ['viaduct', 'Sky Railway'],
  ['compact', 'Small Railway'],
  ['empty', 'A fresh adventure'],
  ['kato-plan06-15', '新干线与在来线交错运行'],
] as const;

function smallLayout(name = 'The current railway'): LayoutData {
  return parseLayout({
    version: 5, name, carCount: 3, trainType: 'e235', trains: [], couplings: [],
    tracks: [{ id: 'current-straight', kind: 's248', x: -124, y: 0, angle: 0, bend: 1, elevation: 0, endElevation: 0 }],
    accessories: [{ id: 'current-platform', kind: 'a-platform', x: 0, y: 65, angle: 0, elevation: 0, stationName: '上野 Ueno' }],
  });
}

function savedDesign(id: string, name: string, layout = smallLayout(name)): SavedDesign {
  return { id, name, updatedAt: '2026-10-12T00:00:00Z', layout: { ...layout, name } };
}

function coupledLayout(): LayoutData {
  const practice = makeCouplingDemo();
  const [reference, partner] = practice.trains!;
  const group = { id: 'saved-joined-pair', e6Id: reference.id, e5Id: partner.id, e6End: 'rear' as const, e5End: 'front' as const };
  const joined = solveCoupledFormation(practice.tracks, reference, partner, group);
  expect(joined.complete).toBe(true);
  return parseLayout({
    ...practice, name: '新大阪: our coupled trains',
    accessories: [{ id: 'saved-platform', kind: 'a-platform', x: 0, y: -300, angle: 0, elevation: 0, stationName: '新大阪 Shin-Osaka' }],
    trains: [reference, { ...partner, position: joined.e5Position, cabForward: joined.e5CabForward }],
    couplings: [group],
  });
}

async function start(page: Page, layout = smallLayout(), designs: SavedDesign[] = [], options: { activeId?: string; rawLibrary?: string } = {}) {
  const time = new Date('2026-10-12T00:00:00Z');
  await page.clock.install({ time });
  await page.clock.pauseAt(time);
  await page.addInitScript(({ working, library, rawLibrary }) => {
    // Do not reinstall fixtures after reload: test persistence, not a reset.
    if (sessionStorage.getItem('layout-dropdown-fixture')) return;
    localStorage.setItem('little-railways-layout-v5', JSON.stringify(working));
    localStorage.setItem('little-railways-saved-designs-v1', rawLibrary ?? JSON.stringify(library));
    sessionStorage.setItem('layout-dropdown-fixture', 'installed');
  }, {
    working: { ...layout, ...(options.activeId ? { savedDesignId: options.activeId } : {}) },
    library: { version: 1, designs }, rawLibrary: options.rawLibrary,
  });
  await page.goto('./');
  await expect(scene(page)).toHaveAttribute('data-ready', 'true');
  await page.clock.fastForward(16);
}

async function current(page: Page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY);
}

async function library(page: Page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), LIBRARY_KEY);
}

async function showChooser(page: Page) {
  await page.getByRole('button', { name: 'Layouts', exact: true }).click();
  await expect(dialog(page)).toBeVisible();
}

test('all sample layouts share one chooser, preview without loading, and open explicitly with undo', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await start(page);
  const original = await current(page);
  await showChooser(page);
  await expect(dialog(page).getByRole('button', { name: 'Close dialog', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(choice(page)).toBeFocused();
  await expect(choice(page)).toHaveValue('');
  await expect(open(page)).toBeDisabled();
  await expect(choice(page).locator('option')).toHaveCount(7);
  await expect(choice(page).locator('optgroup')).toHaveAttribute('label', 'Sample layouts');
  await expect(dialog(page).getByText('No saved layouts yet.', { exact: false })).toBeVisible();
  await expect(dialog(page).getByText('Saved designs stay in this browser on this computer.', { exact: false })).toBeVisible();
  for (const [kind, title] of PRESETS) {
    await expect(choice(page).locator(`option[value="preset:${kind}"]`)).toHaveText(title);
    await choice(page).selectOption(`preset:${kind}`);
    await expect(dialog(page).locator('.layout-selection-details')).toHaveCount(1);
    await expect(dialog(page).locator('.layout-selection-details')).toContainText(title);
    await expect(open(page)).toBeEnabled();
    expect(await current(page), `${title} is only a selection until Open layout`).toEqual(original);
    await expect(page.getByRole('heading', { name: original.name, exact: true })).toBeVisible();
  }
  await choice(page).selectOption('preset:compact');
  await open(page).click();
  await expect(dialog(page)).toHaveCount(0);
  await page.clock.fastForward(16);
  await expect(page.getByRole('heading', { name: 'Small Railway', exact: true })).toBeVisible();
  const compact = await current(page);
  expect(compact.tracks.length).toBeGreaterThan(1);
  expect(compact.carCount).toBe(3);
  await page.getByRole('button', { name: 'Undo last change', exact: true }).click();
  await page.clock.fastForward(16);
  expect(await current(page)).toEqual(original);
  await showChooser(page);
  await choice(page).selectOption('preset:empty');
  await open(page).click();
  await page.clock.fastForward(16);
  expect((await current(page)).tracks).toHaveLength(0);
  await page.getByRole('button', { name: 'Undo last change', exact: true }).click();
  await page.clock.fastForward(16);
  expect(await current(page)).toEqual(original);
  expect(errors).toEqual([]);
});

test('a growing saved library renders only selected details and restores station names and coupled trains intact', async ({ page }, info) => {
  const joined = coupledLayout();
  const designs = Array.from({ length: 20 }, (_, index) => savedDesign(`saved-${index}`, `Our railway ${index + 1}`));
  designs[19] = savedDesign('saved-19', joined.name, joined);
  await start(page, designs[0].layout, designs, { activeId: designs[0].id });
  const original = await current(page);
  await showChooser(page);
  await expect(choice(page)).toHaveValue('saved:saved-0');
  await expect(choice(page).locator('optgroup')).toHaveCount(2);
  await expect(choice(page).locator('optgroup').first()).toHaveAttribute('label', 'Your saved layouts');
  await expect(choice(page).locator('option')).toHaveCount(27);
  await expect(dialog(page).locator('.layout-selection-details')).toHaveCount(1);
  await expect(dialog(page).getByText('Current saved design', { exact: true })).toBeVisible();
  await expect(dialog(page).getByRole('button', { name: /^Delete saved layout / })).toHaveCount(1);
  await choice(page).selectOption('saved:saved-19');
  await expect(dialog(page).locator('.layout-selection-details')).toContainText(joined.name);
  await expect(dialog(page).locator('.layout-selection-details')).toContainText('2 trains');
  await expect(dialog(page).locator('.layout-selection-details')).toContainText(`${joined.tracks.length} tracks · 1 scenery`);
  await expect(dialog(page).getByText('Current saved design', { exact: true })).toHaveCount(0);
  expect(await current(page)).toEqual(original);
  const box = await dialog(page).boundingBox();
  expect(box!.height).toBeLessThan(700);
  const screenshot = info.outputPath('twenty-layouts-one-dropdown.png');
  await dialog(page).screenshot({ path: screenshot });
  await info.attach('compact-layout-chooser', { path: screenshot, contentType: 'image/png' });
  await open(page).click();
  await expect(dialog(page)).toHaveCount(0);
  await page.clock.fastForward(16);
  expect(await current(page)).toEqual({ ...joined, savedDesignId: 'saved-19' });
  const fleet = await scene(page).evaluate(element => JSON.parse((element as HTMLCanvasElement).dataset.fleetPoses ?? '[]'));
  expect(fleet).toHaveLength(2);
  expect(fleet.every((train: { running: boolean; actualSpeed: number }) => !train.running && train.actualSpeed === 0)).toBe(true);
  const groups = await scene(page).evaluate(element => JSON.parse((element as HTMLCanvasElement).dataset.couplingGroups ?? '[]'));
  expect(groups).toMatchObject([{ ...joined.couplings![0], complete: true }]);
  await page.reload();
  await expect(scene(page)).toHaveAttribute('data-ready', 'true');
  await page.clock.fastForward(16);
  expect(await current(page)).toEqual({ ...joined, savedDesignId: 'saved-19' });
  await showChooser(page);
  await expect(choice(page)).toHaveValue('saved:saved-19');
});

test('deletion remains confirmed, changing selection cancels confirmation, and deleting a snapshot preserves the current railway', async ({ page }) => {
  const designs = [savedDesign('first', 'Our first railway'), savedDesign('second', 'Our second railway')];
  await start(page, designs[0].layout, designs, { activeId: 'first' });
  const original = await current(page);
  await showChooser(page);
  await dialog(page).getByRole('button', { name: 'Delete saved layout Our first railway', exact: true }).click();
  await expect(open(page)).toBeDisabled();
  await dialog(page).getByRole('button', { name: 'Keep layout', exact: true }).click();
  expect((await library(page)).designs).toHaveLength(2);
  await expect(open(page)).toBeEnabled();
  await dialog(page).getByRole('button', { name: 'Delete saved layout Our first railway', exact: true }).click();
  await choice(page).selectOption('saved:second');
  await expect(dialog(page).getByText('Delete this saved layout?', { exact: true })).toHaveCount(0);
  await expect(dialog(page).getByRole('button', { name: 'Confirm delete Our first railway', exact: true })).toHaveCount(0);
  await expect(open(page)).toBeEnabled();
  expect((await library(page)).designs).toHaveLength(2);
  await choice(page).selectOption('saved:first');
  await dialog(page).getByRole('button', { name: 'Delete saved layout Our first railway', exact: true }).click();
  await dialog(page).getByRole('button', { name: 'Confirm delete Our first railway', exact: true }).click();
  await expect(choice(page)).toHaveValue('');
  await expect(open(page)).toBeDisabled();
  await expect(choice(page).locator('option[value="saved:first"]')).toHaveCount(0);
  await expect(dialog(page).locator('.layout-selection-details')).toHaveCount(0);
  expect((await library(page)).designs.map((design: SavedDesign) => design.id)).toEqual(['second']);
  const { savedDesignId: _identity, ...railway } = original;
  expect(await current(page)).toEqual(railway);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Layouts', exact: true })).toBeFocused();
});

test('the chooser fits a phone with long saved names and retains keyboard focus navigation', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const longName = 'Our elevated station and passing siding on a rainy Sunday';
  const designs = Array.from({ length: 20 }, (_, index) => savedDesign(`mobile-${index}`, index === 19 ? longName : `Mobile railway ${index + 1}`));
  await start(page, designs[19].layout, designs, { activeId: 'mobile-19' });
  await showChooser(page);
  await expect(dialog(page).getByRole('button', { name: 'Close dialog', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(choice(page)).toBeFocused();
  await expect(choice(page)).toHaveValue('saved:mobile-19');
  await page.keyboard.press('Shift+Tab');
  await expect(dialog(page).getByRole('button', { name: 'Close dialog', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(choice(page)).toBeFocused();
  await expect(dialog(page).locator('.layout-selection-details')).toHaveCount(1);
  await expect(dialog(page).locator('.layout-selection-details')).toContainText(longName);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const box = await dialog(page).boundingBox();
  expect(box!.width).toBeLessThanOrEqual(390);
  expect(box!.height).toBeLessThanOrEqual(844);
  await choice(page).press('Home');
  await expect(choice(page)).toHaveValue('');
  await expect(open(page)).toBeDisabled();
  await choice(page).press('End');
  await expect(choice(page)).toHaveValue('preset:kato-plan06-15');
  await expect(dialog(page).locator('.layout-selection-details')).toContainText('新干线与在来线交错运行');
  await expect(choice(page)).toBeFocused();
  await choice(page).press('Tab');
  await expect(open(page)).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(choice(page)).toBeFocused();
  const screenshot = info.outputPath('mobile-layout-dropdown.png');
  await dialog(page).screenshot({ path: screenshot });
  await info.attach('mobile-layout-chooser', { path: screenshot, contentType: 'image/png' });
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Layouts', exact: true })).toBeFocused();
});

test('unreadable library data retains its error and recovery data while sample layouts remain selectable', async ({ page }) => {
  const damaged = '{"version":1,"designs":[';
  await start(page, smallLayout(), [], { rawLibrary: damaged });
  const original = await current(page);
  await showChooser(page);
  await expect(dialog(page).getByRole('alert')).toContainText('The original data is kept for recovery.');
  await expect(dialog(page).getByText('No saved layouts yet.', { exact: false })).toBeVisible();
  await expect(choice(page).locator('option')).toHaveCount(7);
  await choice(page).selectOption('preset:city');
  await expect(open(page)).toBeEnabled();
  expect(await current(page)).toEqual(original);
  expect(await page.evaluate(key => localStorage.getItem(key), LIBRARY_KEY)).toBe(damaged);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Layouts', exact: true })).toBeFocused();
});
