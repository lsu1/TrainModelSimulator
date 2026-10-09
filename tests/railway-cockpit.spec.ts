import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { makeCouplingDemo } from '../src/couplingDemo';
import type { CouplingOperation } from '../src/couplingTypes';
import type { TrainSnapshot } from '../src/fleet';
import { solveCoupledFormation } from '../src/formationPose';
import type { LayoutData } from '../src/layout';
import type { Track } from '../src/track';

// Exercise the reorganized controls rather than replaying unchanged physics.
// One software-WebGL worker and short clock windows keep this focused suite fast.
test.setTimeout(120_000);
const STORAGE_KEY = 'little-railways-layout-v5';
const scene = (page: Page) => page.getByRole('img', { name: '3D railway layout: rotate, zoom, select trains, and move Kato track pieces' });
const screen = (page: Page) => page.getByRole('region', { name: 'Railway control screen', exact: true });
const trainCard = (page: Page, id: string) => page.getByRole('group', { name: 'Select a train to drive', exact: true }).locator(`button[data-train-id="${id}"]`);
const speed = (page: Page) => page.getByRole('slider', { name: 'Train speed', exact: true });
type Runtime = TrainSnapshot & {
  actualSpeed: number; running: boolean; status: string; selected: boolean;
  cars: { noseCoupler?: { state: { open: number } } }[];
};

function line(prefix: string, y: number): Track[] {
  return Array.from({ length: 14 }, (_, index) => ({
    id: `${prefix}-${index}`, kind: 's248', x: index * 248, y, angle: 0,
    bend: 1, elevation: 0, endElevation: 0,
  }));
}

function independentLayout(count = 2): LayoutData {
  const tracks = [...line('main', 0), ...line('second', 100)];
  const trains: TrainSnapshot[] = Array.from({ length: count }, (_, index) => ({
    id: `cockpit-train-${index + 1}`, name: `Green train ${index + 1}`, type: 'e235', carCount: 3,
    position: index < 2 ? { trackId: `${index ? 'second' : 'main'}-4`, distance: 208, direction: 1, route: 0, laps: 0 } : null,
    cabForward: true, requestedSpeed: index ? 40 : 20,
  }));
  return { version: 5, name: 'Everything at your fingertips', tracks, accessories: [], trains, couplings: [], selectedTrainId: trains[0]?.id, trainType: 'e235', carCount: 3 };
}

function clearTurnout(): Track {
  return { id: 'cockpit-switch', kind: 't4l', x: 0, y: 900, angle: 0, bend: 1, elevation: 0, endElevation: 0, switchNumber: 1, switchState: 'straight' };
}

async function freeze(page: Page) {
  const time = new Date('2026-01-01T00:00:00Z');
  await page.clock.install({ time });
  await page.clock.pauseAt(time);
}

async function advance(page: Page, milliseconds: number) {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 100) await page.clock.fastForward(Math.min(100, milliseconds - elapsed));
  await page.clock.fastForward(16);
}

async function seed(page: Page, value: LayoutData) {
  await page.addInitScript(({ key, value }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value));
  }, { key: STORAGE_KEY, value });
  await page.goto('/');
  await expect(scene(page)).toHaveAttribute('data-ready', 'true');
  await advance(page, 100);
}

async function fleet(page: Page): Promise<Runtime[]> {
  return scene(page).evaluate(element => JSON.parse((element as HTMLCanvasElement).dataset.fleetPoses ?? '[]'));
}

async function operation(page: Page): Promise<CouplingOperation | null> {
  return scene(page).evaluate(element => JSON.parse((element as HTMLCanvasElement).dataset.couplingOperation ?? 'null'));
}

async function scrollPosition(page: Page) {
  return page.evaluate(() => ({ x: scrollX, y: scrollY }));
}

async function visibleInside(page: Page, locator: Locator) {
  const bounds = await locator.boundingBox();
  const cockpit = await screen(page).boundingBox();
  const viewport = page.viewportSize()!;
  expect(bounds, `${await locator.getAttribute('aria-label') ?? 'Control'} has a visible box`).not.toBeNull();
  expect(cockpit).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(cockpit!.x - 1);
  expect(bounds!.y).toBeGreaterThanOrEqual(cockpit!.y - 1);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(cockpit!.x + cockpit!.width + 1);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(cockpit!.y + cockpit!.height + 1);
  expect(bounds!.x).toBeGreaterThanOrEqual(-1);
  expect(bounds!.y).toBeGreaterThanOrEqual(-1);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1);
}

async function expectCockpitFits(page: Page, includeSwitch = false, drafting = false) {
  // Bounding boxes do not auto-scroll, unlike clicks or screenshots. These
  // assertions therefore catch controls drifting outside the usable screen.
  await visibleInside(page, screen(page));
  for (const locator of [speed(page),
    page.getByRole('combobox', { name: drafting ? 'New train model' : 'Train', exact: true }),
    page.getByRole('combobox', { name: drafting ? 'New train car count' : 'Train car count', exact: true }),
    page.getByRole('button', { name: /^(Run|Pause) train$/ }),
    page.getByRole('button', { name: 'Reverse train direction', exact: true }),
    page.getByRole('button', { name: 'Sound train horn', exact: true }),
    page.getByRole('button', { name: 'Place selected train', exact: true }),
    page.getByRole('button', { name: 'Remove selected train', exact: true }),
    page.getByRole('button', { name: drafting ? 'Add train' : 'Prepare a new train', exact: true }),
  ]) await visibleInside(page, locator);
  if (drafting && await page.getByRole('button', { name: 'Cancel new train', exact: true }).count()) await visibleInside(page, page.getByRole('button', { name: 'Cancel new train', exact: true }));
  await expect(page.getByRole('button', { name: 'Pause all trains', exact: true })).toHaveCount(0);
  await expect(screen(page).locator('.cockpit-add-row')).toHaveCount(0);
  const trainBar = page.getByRole('region', { name: 'Your trains', exact: true });
  const createActions = trainBar.locator('.cockpit-create-actions');
  const createBounds = (await createActions.boundingBox())!;
  const barBounds = (await trainBar.boundingBox())!;
  expect(createBounds.y).toBeGreaterThanOrEqual(barBounds.y - 1);
  expect(createBounds.y + createBounds.height).toBeLessThanOrEqual(barBounds.y + barBounds.height + 1);
  await expect(createActions.getByRole('button', { name: drafting ? 'Add train' : 'Prepare a new train', exact: true })).toHaveCount(1);
  expect(await createActions.evaluate(element => Boolean(element.compareDocumentPosition(element.parentElement!.querySelector('.cockpit-model-select')!) & Node.DOCUMENT_POSITION_FOLLOWING)), 'Train creation controls precede the shared model editor in the top bar').toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const stage = (await page.getByTestId('railway-canvas-stage').boundingBox())!;
  const dock = (await page.getByTestId('railway-driving-dock').boundingBox())!;
  const trainList = (await page.getByRole('region', { name: 'Your trains', exact: true }).boundingBox())!;
  expect(stage.height, 'Controls leave a usable railway viewport').toBeGreaterThanOrEqual(200);
  expect(trainList.y + trainList.height).toBeLessThanOrEqual(stage.y + 1);
  expect(stage.y + stage.height).toBeLessThanOrEqual(dock.y + 1);
  if (includeSwitch) {
    const desk = page.getByRole('region', { name: 'Turnout switch controls', exact: true });
    await visibleInside(page, desk);
    for (const name of ['Switch 1 straight', 'Switch 1 branch']) await visibleInside(page, desk.getByRole('button', { name, exact: true }));
    const bounds = (await desk.boundingBox())!;
    expect(Math.min(stage.x + stage.width, bounds.x + bounds.width) - Math.max(stage.x, bounds.x), 'Switch desk does not cover the railway canvas').toBeLessThanOrEqual(1);
  }
}

async function expectActiveChipVisible(page: Page, trainId: string) {
  const strip = page.getByRole('group', { name: 'Select a train to drive', exact: true });
  const chip = strip.locator(`button[data-train-id="${trainId}"]`);
  // Browser resize notifications settle independently of the frozen train clock.
  // Poll the visible geometry instead of reading between layout and ResizeObserver.
  await expect.poll(() => chip.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const viewport = element.parentElement!.getBoundingClientRect();
    return Math.max(viewport.left - bounds.left, bounds.right - viewport.right);
  }), { message: 'The active train card stays inside the resized fleet strip' }).toBeLessThanOrEqual(1);
  expect(await strip.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
}

test('Mac-sized screens keep driving and active-train controls in view without page scrolling', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await freeze(page);
  await seed(page, independentLayout());
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(viewport);
    await advance(page, 100);
    expect(await scrollPosition(page)).toEqual({ x: 0, y: 0 });
    await expectCockpitFits(page);
  }
  await expect(screen(page).getByLabel('Train count', { exact: true })).toHaveText('2 trains');
  await expect(page.getByText('laps explored', { exact: true })).toHaveCount(0);
  for (const name of ['Reverse train direction', 'Sound train horn']) {
    expect((await page.getByRole('button', { name, exact: true }).innerText()).trim(), 'Familiar icons have no explanation underneath').toBe('');
  }
  // The single editor changes the active set, or prepares a separate draft.
  // Drafting must never mutate a real train until Add train is confirmed.
  await expect(page.getByRole('combobox', { name: 'Train to drive', exact: true })).toHaveCount(0);
  const initial = await fleet(page);
  await page.getByRole('button', { name: 'Prepare a new train', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit new train', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('combobox', { name: 'Train', exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'New train model', exact: true }).selectOption('e7');
  await page.getByRole('combobox', { name: 'New train car count', exact: true }).selectOption('7');
  await advance(page, 100);
  await scene(page).press('Space');
  await scene(page).press('r');
  await advance(page, 100);
  expect(await fleet(page), 'A draft cannot drive or reverse the previously selected train through shortcuts').toEqual(initial);
  await expectCockpitFits(page, false, true);
  await page.screenshot({ path: info.outputPath('main-screen-shared-new-train-editor.png') });
  for (const name of ['Run train', 'Reverse train direction', 'Sound train horn', 'Place selected train', 'Remove selected train']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
  }
  await expect(speed(page)).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel new train', exact: true }).click();
  await advance(page, 100);
  await expect(trainCard(page, 'cockpit-train-1')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('combobox', { name: 'Train', exact: true })).toHaveValue('e235');
  expect(await fleet(page)).toEqual(initial);
  await page.getByRole('button', { name: 'Prepare a new train', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'New train model', exact: true })).toHaveValue('e7');
  await expect(page.getByRole('combobox', { name: 'New train car count', exact: true })).toHaveValue('7');
  await trainCard(page, 'cockpit-train-2').click();
  await advance(page, 100);
  await expect(page.getByRole('button', { name: 'Edit new train', exact: true })).toHaveCount(0);
  await expect(trainCard(page, 'cockpit-train-2')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('combobox', { name: 'Train car count', exact: true })).toHaveValue('3');
  expect((await fleet(page)).map(({ selected: _selected, ...train }) => train)).toEqual(initial.map(({ selected: _selected, ...train }) => train));
  await page.getByRole('button', { name: 'Prepare a new train', exact: true }).click();
  const body = await scene(page).evaluate(element => {
    const point = JSON.parse((element as HTMLCanvasElement).dataset.trainPickPoints!)["cockpit-train-2"];
    const bounds = element.getBoundingClientRect();
    return { x: bounds.x + point.x, y: bounds.y + point.y };
  });
  await page.mouse.click(body.x, body.y);
  await advance(page, 100);
  await expect(page.getByRole('button', { name: 'Edit new train', exact: true })).toHaveCount(0);
  await expect(trainCard(page, 'cockpit-train-2')).toHaveAttribute('aria-pressed', 'true');
  await trainCard(page, 'cockpit-train-1').click();
  await page.getByRole('combobox', { name: 'Train', exact: true }).selectOption('e6');
  await page.getByRole('combobox', { name: 'Train car count', exact: true }).selectOption('4');
  await advance(page, 100);
  expect((await fleet(page))[0]).toMatchObject({ type: 'e6', carCount: 4 });
  expect((await fleet(page))[1]).toEqual(initial[1]);
  await page.getByRole('combobox', { name: 'Train car count', exact: true }).selectOption('3');
  await page.getByRole('combobox', { name: 'Train', exact: true }).selectOption('e235');
  await advance(page, 100);
  await page.getByRole('button', { name: 'Run train', exact: true }).click();
  await advance(page, 600);
  const moving = await fleet(page);
  expect(moving[0].actualSpeed).toBeGreaterThan(0);
  expect(moving[1].actualSpeed).toBe(0);
  await expect(page.getByRole('combobox', { name: 'Train', exact: true })).toBeDisabled();
  await expect(page.getByRole('combobox', { name: 'Train car count', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Prepare a new train', exact: true }).click();
  await expect(page.getByRole('button', { name: /^(Run|Pause) train$/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Pause all trains', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel new train', exact: true }).click();
  await page.getByRole('button', { name: 'Pause train', exact: true }).click();
  await advance(page, 100);
  expect((await fleet(page)).every(train => !train.running && train.actualSpeed === 0), 'The main pause control stops the selected train after leaving its draft editor').toBe(true);
  await page.getByRole('button', { name: 'Run train', exact: true }).click();
  await advance(page, 100);
  await speed(page).focus();
  await speed(page).press('End');
  await expect(speed(page)).toHaveValue('90');
  await page.getByRole('button', { name: 'Pause train', exact: true }).click();
  await advance(page, 100);
  await page.getByRole('button', { name: 'Reverse train direction', exact: true }).click();
  await advance(page, 100);
  expect((await fleet(page))[0].cabForward).toBe(!initial[0].cabForward);
  await page.getByRole('button', { name: 'Sound train horn', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Toot toot!' })).toBeVisible();
  await trainCard(page, 'cockpit-train-2').click();
  await advance(page, 100);
  await expect(speed(page)).toHaveValue('40');
  await expect(page.getByRole('button', { name: 'Drive Green train 2', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Run train', exact: true }).click();
  await advance(page, 100);
  await trainCard(page, 'cockpit-train-1').click();
  await page.getByRole('button', { name: 'Run train', exact: true }).click();
  await advance(page, 100);
  await page.getByRole('button', { name: 'Pause train', exact: true }).click();
  await advance(page, 100);
  expect((await fleet(page))[1].running, 'Pausing one train preserves the other train’s journey').toBe(true);
  await trainCard(page, 'cockpit-train-2').click();
  await page.getByRole('button', { name: 'Pause train', exact: true }).click();
  await advance(page, 100);
  expect((await fleet(page)).every(train => !train.running && train.actualSpeed === 0)).toBe(true);
  expect(await scrollPosition(page)).toEqual({ x: 0, y: 0 });
  await expectCockpitFits(page);
  await page.screenshot({ path: info.outputPath('short-mac-main-screen.png') });
  expect(errors).toEqual([]);
});

test('numbered switches, joining, nose view and separation operate from the same main screen', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 720 });
  await freeze(page);
  const practice = makeCouplingDemo({ firstType: 'e7', secondType: 'e5' });
  practice.tracks.push(clearTurnout());
  await seed(page, practice);
  await expectCockpitFits(page, true);
  const desk = page.getByRole('region', { name: 'Turnout switch controls', exact: true });
  const branch = desk.getByRole('button', { name: 'Switch 1 branch', exact: true });
  await branch.click();
  await advance(page, 400);
  await expect(branch).toHaveAttribute('aria-pressed', 'true');
  const point = await scene(page).evaluate(element => JSON.parse((element as HTMLCanvasElement).dataset.turnoutPoints ?? '[]').find((value: { id: string }) => value.id === 'cockpit-switch'));
  expect(point.target).toBe(1);
  expect(point.fraction).toBe(1);
  await page.getByRole('button', { name: 'Toggle switch controls', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Toggle switch controls', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: 'Toggle switch controls', exact: true }).click();
  await visibleInside(page, page.getByRole('button', { name: 'Couple trains', exact: true }));
  await page.getByRole('button', { name: 'Couple trains', exact: true }).click();
  await advance(page, 800);
  expect((await operation(page))?.phase).toBe('opening');
  await visibleInside(page, page.getByRole('button', { name: 'Nose view', exact: true }));
  await page.getByRole('button', { name: 'Nose view', exact: true }).click();
  await advance(page, 100);
  await page.getByRole('button', { name: 'Pause coupling', exact: true }).click();
  await advance(page, 100);
  expect((await operation(page))?.paused).toBe(true);
  await expect(speed(page)).toBeDisabled();
  await expect(branch).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Prepare a new train', exact: true })).toBeDisabled();
  await expect(page.getByRole('combobox', { name: 'Train', exact: true })).toBeDisabled();
  await expect(page.getByRole('combobox', { name: 'Train car count', exact: true })).toBeDisabled();
  const partiallyOpen = Math.max(...(await fleet(page))[0].cars.map(car => car.noseCoupler?.state.open ?? 0));
  expect(partiallyOpen).toBeGreaterThan(0);
  expect(partiallyOpen).toBeLessThan(1);
  await page.getByRole('button', { name: 'Continue coupling', exact: true }).click();
  await advance(page, 300);
  expect(Math.max(...(await fleet(page))[0].cars.map(car => car.noseCoupler?.state.open ?? 0))).toBeGreaterThan(partiallyOpen);
  expect(await scrollPosition(page)).toEqual({ x: 0, y: 0 });
  await expectCockpitFits(page, true);
  await page.screenshot({ path: info.outputPath('main-screen-opening-noses.png') });

  // Restore a settled formation to check the new separation controls without
  // replaying the unchanged twenty-second physical approach.
  const [reference, partner] = practice.trains!;
  const group = { id: 'cockpit-joined-pair', e6Id: reference.id, e5Id: partner.id, e6End: 'rear' as const, e5End: 'front' as const };
  const joined = solveCoupledFormation(practice.tracks, reference, partner, group);
  expect(joined.complete).toBe(true);
  const stable: LayoutData = { ...practice, trains: [reference, { ...partner, position: joined.e5Position, cabForward: joined.e5CabForward }], couplings: [group] };
  // Apply after the previous page's final autosave, once per browser session.
  // Writing on the old document would let pagehide restore its interrupted join.
  await page.addInitScript(({ key, value, marker }) => {
    if (!sessionStorage.getItem(marker)) {
      localStorage.setItem(key, JSON.stringify(value));
      sessionStorage.setItem(marker, 'installed');
    }
  }, { key: STORAGE_KEY, value: stable, marker: 'cockpit-settled-pair-fixture' });
  await page.reload();
  await expect(scene(page)).toHaveAttribute('data-ready', 'true');
  await advance(page, 100);
  await expect(speed(page)).toHaveAttribute('max', '275');
  await expect(page.getByRole('combobox', { name: 'Train', exact: true })).toBeDisabled();
  await expect(page.getByRole('combobox', { name: 'Train car count', exact: true })).toBeEnabled();
  await page.getByRole('combobox', { name: 'Train car count', exact: true }).selectOption('4');
  await advance(page, 100);
  expect((await fleet(page)).find(train => train.id === reference.id)?.carCount).toBe(4);
  expect((await fleet(page)).find(train => train.id === partner.id)?.carCount).toBe(3);
  await expect(page.getByRole('region', { name: 'Nose coupling', exact: true })).toContainText('7 cars');
  const resized = await scene(page).evaluate(element => JSON.parse((element as HTMLCanvasElement).dataset.couplingGroups ?? '[]'));
  expect(resized).toHaveLength(1);
  expect(resized[0].complete, 'Changing a stopped member length keeps the articulated formation intact').toBe(true);
  await visibleInside(page, page.getByRole('button', { name: 'Decouple trains', exact: true }));
  await page.getByRole('button', { name: 'Nose view', exact: true }).click();
  await page.getByRole('button', { name: 'Decouple trains', exact: true }).click();
  await advance(page, 250);
  expect((await operation(page))?.phase).toBe('unlocking');
  await page.getByRole('button', { name: 'Pause coupling', exact: true }).click();
  await advance(page, 100);
  expect((await operation(page))?.paused).toBe(true);
  expect(await scrollPosition(page)).toEqual({ x: 0, y: 0 });
  await expectCockpitFits(page, true);
  expect(errors).toEqual([]);
});

test('one editor adds the first train and supports a full scrolling fleet without duplication', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 720 });
  await freeze(page);
  await seed(page, independentLayout(0));
  await expect(screen(page).getByLabel('Train count', { exact: true })).toHaveText('0 trains');
  await expect(page.getByRole('button', { name: 'Cancel new train', exact: true })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Train', exact: true })).toHaveCount(0);
  await expectCockpitFits(page, false, true);
  await page.getByRole('combobox', { name: 'New train model', exact: true }).selectOption('e5');
  await page.getByRole('combobox', { name: 'New train car count', exact: true }).selectOption('4');
  await expectCockpitFits(page, false, true);
  expect(await fleet(page)).toHaveLength(0);
  await page.getByRole('button', { name: 'Add train', exact: true }).click();
  await advance(page, 100);
  const first = (await fleet(page))[0];
  expect(first).toMatchObject({ type: 'e5', carCount: 4 });
  await expect(trainCard(page, first.id)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('combobox', { name: 'Train', exact: true })).toHaveValue('e5');
  await expect(page.getByRole('combobox', { name: 'Train car count', exact: true })).toHaveValue('4');
  await expect(page.getByRole('button', { name: 'Add train', exact: true })).toHaveCount(0);

  // Seed twelve sets in the next document, after the outgoing autosave.
  await page.addInitScript(({ key, value, marker }) => {
    if (!sessionStorage.getItem(marker)) {
      localStorage.setItem(key, JSON.stringify(value));
      sessionStorage.setItem(marker, 'installed');
    }
  }, { key: STORAGE_KEY, value: independentLayout(12), marker: 'unified-full-fleet-fixture' });
  await page.reload();
  await expect(scene(page)).toHaveAttribute('data-ready', 'true');
  await advance(page, 100);
  await expectCockpitFits(page);
  await expect(screen(page).getByLabel('Train count', { exact: true })).toHaveText('12 trains');
  await expect(page.getByRole('button', { name: 'Prepare a new train', exact: true })).toBeDisabled();
  await trainCard(page, 'cockpit-train-12').click();
  await advance(page, 100);
  await expect(trainCard(page, 'cockpit-train-12')).toHaveAttribute('aria-pressed', 'true');
  await expectActiveChipVisible(page, 'cockpit-train-12');
  await expect(page.getByRole('button', { name: 'Run train', exact: true })).toBeDisabled();
  expect(await scrollPosition(page)).toEqual({ x: 0, y: 0 });
  await page.getByRole('button', { name: 'Remove selected train', exact: true }).click();
  await advance(page, 100);
  const survivors = await fleet(page);
  await page.getByRole('button', { name: 'Prepare a new train', exact: true }).click();
  await page.getByRole('combobox', { name: 'New train model', exact: true }).selectOption('e235');
  await page.getByRole('combobox', { name: 'New train car count', exact: true }).selectOption('11');
  await advance(page, 100);
  await expectActiveChipVisible(page, '__new-train__');
  await page.getByRole('combobox', { name: 'New train model', exact: true }).selectOption('e7');
  await page.getByRole('combobox', { name: 'New train car count', exact: true }).selectOption('7');
  await advance(page, 100);
  expect(await fleet(page)).toEqual(survivors);
  await page.getByRole('button', { name: 'Add train', exact: true }).click();
  await advance(page, 100);
  const trains = await fleet(page);
  expect(trains).toHaveLength(12);
  expect(trains.at(-1)).toMatchObject({ type: 'e7', carCount: 7 });
  await expect(trainCard(page, trains.at(-1)!.id)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('combobox', { name: 'Train car count', exact: true })).toHaveValue('7');
  await expectActiveChipVisible(page, trains.at(-1)!.id);
  expect(await scrollPosition(page)).toEqual({ x: 0, y: 0 });
  await expectCockpitFits(page);
  await page.screenshot({ path: info.outputPath('main-screen-full-fleet.png') });
  for (const viewport of [{ width: 980, height: 740 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await advance(page, 100);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(screen(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sound train horn', exact: true })).toBeVisible();
    await expect(trainCard(page, trains.at(-1)!.id)).toHaveAttribute('aria-pressed', 'true');
    await expectActiveChipVisible(page, trains.at(-1)!.id);
  }
  await page.screenshot({ path: info.outputPath('main-screen-mobile.png') });
  expect(errors).toEqual([]);
});
