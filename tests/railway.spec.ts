import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const STORAGE_KEY = 'little-railways-layout-v1';
const straightButton = 'Add 248 mm straight';
const curveButton = 'Add 282 mm radius · 45° curve';

async function startFresh(page: Page) {
  await page.getByRole('button', { name: 'Layouts', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: /A fresh adventure/ }).click();
  await expect(page.getByText('0 pieces', { exact: true })).toBeVisible();
}

async function engineTransform(page: Page) {
  return page.getByTestId('train').locator(':scope > g').last().getAttribute('transform');
}

async function engineX(page: Page) {
  const transform = await engineTransform(page);
  const match = transform?.match(/^translate\(([-\d.e+]+)/);
  if (!match) throw new Error(`Missing engine position: ${transform}`);
  return Number(match[1]);
}

async function savedLayout(page: Page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY);
}

async function freezeAnimationClock(page: Page) {
  const time = new Date('2026-01-01T00:00:00Z');
  await page.clock.install({ time });
  await page.clock.pauseAt(time);
}

test('starter railway is a complete 12-piece loop without browser errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Sunny Valley', exact: true })).toBeVisible();
  await expect(page.getByText('12 pieces', { exact: true })).toBeVisible();
  await expect(page.getByText('Loop complete · ready to ride', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Select .* track$/ })).toHaveCount(12);
  await expect(page.getByRole('button', { name: /^Build from open end/ })).toHaveCount(0);
  await expect(page.getByTestId('train').locator(':scope > g')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Run train', exact: true })).toBeEnabled();

  await page.getByRole('button', { name: 'Run train', exact: true }).click();
  await expect(page.getByText('On an adventure', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pause train', exact: true }).click();
  expect(errors).toEqual([]);
});

test('train moves at the selected speed, pauses, and runs in reverse', async ({ page }) => {
  await freezeAnimationClock(page);
  await page.goto('/');
  const slider = page.getByRole('slider', { name: 'Train speed' });
  await slider.focus();
  await slider.press('Home');
  await expect(slider).toHaveValue('5');
  const initialX = await engineX(page);

  await page.getByRole('button', { name: 'Run train', exact: true }).click();
  await page.clock.runFor(500);
  const slowX = await engineX(page);
  expect(slowX).toBeGreaterThan(initialX);

  await slider.focus();
  await slider.press('End');
  await expect(slider).toHaveValue('100');
  await page.clock.runFor(500);
  const fastX = await engineX(page);
  expect(fastX - slowX).toBeGreaterThan((slowX - initialX) * 10);

  await page.getByRole('button', { name: 'Pause train', exact: true }).click();
  const paused = await engineTransform(page);
  await page.clock.runFor(1000);
  expect(await engineTransform(page)).toBe(paused);

  await page.getByRole('button', { name: 'Reverse train direction' }).click();
  expect(await engineTransform(page)).toBe(paused);
  const reverseX = await engineX(page);
  await page.getByRole('button', { name: 'Run train', exact: true }).click();
  await page.clock.runFor(250);
  expect(await engineX(page)).toBeLessThan(reverseX);
});

test('a train stops at an open end and can reverse away from it', async ({ page }) => {
  await freezeAnimationClock(page);
  await page.goto('/');
  await startFresh(page);
  await expect(page.getByRole('button', { name: 'Run train', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: straightButton, exact: true }).click();
  const slider = page.getByRole('slider', { name: 'Train speed' });
  await slider.focus();
  await slider.press('End');
  await page.getByRole('button', { name: 'Run train', exact: true }).click();
  await page.clock.runFor(2000);
  await expect(page.getByRole('button', { name: 'Run train', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('End of the line!');
  const endX = await engineX(page);
  await page.clock.runFor(500);
  expect(await engineX(page)).toBe(endX);
  await page.getByRole('button', { name: 'Reverse train direction' }).click();
  await page.getByRole('button', { name: 'Run train', exact: true }).click();
  await page.clock.runFor(250);
  expect(await engineX(page)).toBeLessThan(endX);
  await expect(page.getByRole('button', { name: 'Pause train', exact: true })).toBeVisible();
});

test('laps count full circuits and reversing starts a fresh partial lap', async ({ page }) => {
  await freezeAnimationClock(page);
  await page.goto('/');
  const slider = page.getByRole('slider', { name: 'Train speed' });
  const laps = page.locator('.lap-stat > span');
  await slider.focus();
  await slider.press('End');
  await page.getByRole('button', { name: 'Run train', exact: true }).click();

  // At 100 km/h in 1:160 scale, the 2.764 m loop takes about 15.92 s.
  // The train starts 35 mm into a piece: crossing that piece's start is
  // slightly earlier and must not count as a complete circuit.
  await page.clock.runFor(15_850);
  await expect(laps).toHaveText('00');
  await page.clock.runFor(200);
  await expect(laps).toHaveText('01');

  await page.clock.runFor(8_000);
  await expect(laps).toHaveText('01');
  await page.getByRole('button', { name: 'Pause train', exact: true }).click();
  await page.getByRole('button', { name: 'Reverse train direction' }).click();
  await page.getByRole('button', { name: 'Run train', exact: true }).click();
  await page.clock.runFor(8_000);
  await expect(laps).toHaveText('01');
  await page.clock.runFor(8_100);
  await expect(laps).toHaveText('02');
});

test('build, select, remove, and undo a track piece', async ({ page }) => {
  await page.goto('/');
  await startFresh(page);
  await page.getByRole('button', { name: straightButton, exact: true }).click();
  await expect(page.getByText('1 pieces', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Build from open end/ })).toHaveCount(2);
  const track = page.getByRole('button', { name: 'Select 248 mm straight track', exact: true });
  // Horizontal SVG paths have zero-height boxes; click their painted stroke.
  const midpoint = await track.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  });
  await page.mouse.click(midpoint.x, midpoint.y);
  await expect(page.getByText('SELECTED PIECE', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByText('0 pieces', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo last change' }).click();
  await expect(track).toHaveCount(1);
  await expect(page.getByText('1 pieces', { exact: true })).toBeVisible();
});

test('left and right curves follow the selected bend', async ({ page }) => {
  await page.goto('/');
  await startFresh(page);
  await page.getByRole('button', { name: 'Curved tracks', exact: true }).click();
  await page.getByRole('button', { name: 'Bend left', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Bend left', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: curveButton, exact: true }).click();
  expect((await savedLayout(page)).tracks[0].bend).toBe(-1);
  await page.getByRole('button', { name: 'Bend right', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Bend right', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: curveButton, exact: true }).click();
  expect((await savedLayout(page)).tracks[1].bend).toBe(1);
  await expect(page.getByText('2 pieces', { exact: true })).toBeVisible();
});

test('eight R282 curves close a circle and survive reloading', async ({ page }) => {
  await page.goto('/');
  await startFresh(page);
  await page.getByRole('button', { name: 'Curved tracks', exact: true }).click();
  for (let index = 0; index < 8; index++) {
    await page.getByRole('button', { name: curveButton, exact: true }).click();
  }
  await expect(page.getByText('8 pieces', { exact: true })).toBeVisible();
  await expect(page.getByText('Loop complete · ready to ride', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Build from open end/ })).toHaveCount(0);
  const saved = await savedLayout(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'My Railway', exact: true })).toBeVisible();
  await expect(page.getByText('8 pieces', { exact: true })).toBeVisible();
  await expect(page.getByText('Loop complete · ready to ride', { exact: true })).toBeVisible();
  expect(await savedLayout(page)).toEqual(saved);
});

test('save a real layout file and open it to restore the railway', async ({ page }, testInfo) => {
  await page.goto('/');
  await startFresh(page);
  await page.getByRole('button', { name: straightButton, exact: true }).click();
  await page.getByRole('button', { name: 'Add 124 mm straight', exact: true }).click();
  const saved = await savedLayout(page);
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
  await expect(page.getByText('2 pieces', { exact: true })).toBeVisible();
  expect(await savedLayout(page)).toEqual(saved);
});

test('invalid imports preserve the current railway and allow a later valid import', async ({ page }) => {
  await page.goto('/');
  const original = await savedLayout(page);
  await page.getByRole('button', { name: 'Layouts', exact: true }).click();
  const fileInput = page.getByLabel('Open railway file');
  await fileInput.setInputFiles({
    name: 'broken.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ version: 1, name: 'Broken', tracks: [{ id: 'bad', kind: 'unknown', x: 0, y: 0, angle: 0, bend: 1 }] })),
  });
  await expect(page.getByRole('status')).toContainText('invalid track piece');
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await savedLayout(page)).toEqual(original);
  await expect(page.getByText('12 pieces', { exact: true })).toBeVisible();

  const imported = { version: 1, name: 'Dad and son railway', tracks: [{ id: 'our-straight', kind: 's248', x: -100, y: 0, angle: 0, bend: 1 }] };
  await fileInput.setInputFiles({ name: 'our-railway.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: imported.name, exact: true })).toBeVisible();
  await expect(page.getByText('1 pieces', { exact: true })).toBeVisible();
  expect(await savedLayout(page)).toEqual(imported);
});

test('Mac keyboard shortcuts control trains and undo building without hijacking inputs', async ({ page }) => {
  await freezeAnimationClock(page);
  await page.goto('/');
  await page.getByRole('slider', { name: 'Train speed' }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Run train', exact: true })).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Pause train', exact: true })).toBeVisible();
  await page.clock.runFor(200);
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Run train', exact: true })).toBeVisible();
  const beforeReverse = await engineTransform(page);
  const beforeReverseX = await engineX(page);
  await page.keyboard.press('r');
  expect(await engineTransform(page)).toBe(beforeReverse);
  await page.keyboard.press('Space');
  await page.clock.runFor(150);
  expect(await engineX(page)).toBeLessThan(beforeReverseX);
  await page.keyboard.press('Space');

  await startFresh(page);
  await page.getByRole('button', { name: straightButton, exact: true }).click();
  await expect(page.getByRole('button', { name: straightButton, exact: true })).toBeFocused();
  await page.keyboard.press('Meta+z');
  await expect(page.getByText('0 pieces', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: straightButton, exact: true }).click();
  const track = page.getByRole('button', { name: 'Select 248 mm straight track', exact: true });
  await track.focus();
  await page.keyboard.press('Space');
  await expect(page.getByText('SELECTED PIECE', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run train', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause train', exact: true })).toHaveCount(0);
});

test('help dialog traps focus, ignores train shortcuts, and restores focus on Escape', async ({ page }) => {
  await page.goto('/');
  const helpButton = page.getByRole('button', { name: 'How to play', exact: true });
  const transform = await engineTransform(page);
  await helpButton.click();
  const dialog = page.getByRole('dialog', { name: 'Your railway. Your imagination.' });
  const closeButton = dialog.getByRole('button', { name: 'Close dialog', exact: true });
  const letsPlay = dialog.getByRole('button', { name: 'Let’s play', exact: true });
  await expect(closeButton).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(letsPlay).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(closeButton).toBeFocused();
  await page.keyboard.press('r');
  expect(await engineTransform(page)).toBe(transform);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(helpButton).toBeFocused();
});

test('small screens retain usable controls without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Run train', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Curved tracks', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Layouts', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
