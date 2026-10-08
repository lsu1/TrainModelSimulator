import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { attachTrack, endpoints, pathsFor } from '../src/track';
import type { Track } from '../src/track';
import { getCouplingLinkLength, getTrainCarSpec, getTrainSpec } from '../src/trains';
import type { TrainType } from '../src/trains';

// Detailed cars use software WebGL in cloud checks, with a single worker.
test.setTimeout(90_000);
const STORAGE_KEY = 'little-railways-layout-v4';
const LIBRARY_KEY = 'little-railways-saved-designs-v1';
const scene = (page: Page) => page.getByRole('img', { name: '3D railway layout: rotate, zoom, select trains, and move Kato track pieces' });
const selector = (page: Page) => page.getByRole('combobox', { name: 'Train', exact: true });

type Point = { x: number; y: number; z: number };
type Car = {
  index: number; visible: boolean; model: string; length: number; bogieOffset: number;
  cab: boolean; noseDirection: number; noseLength: number; scale: number;
  center: Point; frontBogie: Point; rearBogie: Point; frontEnd: Point; rearEnd: Point;
  frontGangway: Point; rearGangway: Point; quaternion: [number, number, number, number];
};
type Coupling = { index: number; visible: boolean; front: Point; rear: Point; frontGangway: Point; rearGangway: Point };
const gap = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function straightFixture(trainType?: TrainType) {
  const tracks: Track[] = Array.from({ length: 4 }, (_, index) => ({
    id: `straight-${index}`, kind: 's248', x: index * 248, y: 0, angle: 0,
    bend: 1, elevation: 0, endElevation: 0,
  }));
  // Put the complete three-car formation on rails at initial placement.
  return {
    version: 2, name: 'Trains on our test railway', carCount: 3, accessories: [],
    tracks: [tracks[2], tracks[0], tracks[1], tracks[3]],
    ...(trainType ? { trainType } : {}),
  };
}

function curvedGradeFixture(trainType: TrainType, carCount: 3 | 11) {
  const tracks: Track[] = [];
  let anchor = { position: { x: -1984, y: 0, z: 0 }, angle: 0 };
  const append = (kind: string, change = 0) => {
    const track = attachTrack(kind, 1, anchor, `formation-${tracks.length}`);
    track.elevation = anchor.position.z;
    track.endElevation = anchor.position.z + change;
    tracks.push(track);
    const end = endpoints(track)[1];
    anchor = { position: { x: end.position.x, y: end.position.y, z: end.position.z ?? 0 }, angle: end.angle };
  };
  for (let i = 0; i < 8; i += 1) append('s248');
  const approach = tracks.at(-1)!;
  // R348 curves are above the sourced KATO minimum for all three trains.
  // Each ascending quarter-curve has a gentle 6 mm rise, then the far side
  // and descent complete a long loop that accommodates eleven cars.
  for (let i = 0; i < 4; i += 1) append('c348', 6);
  for (let i = 0; i < 8; i += 1) append('s248');
  for (let i = 0; i < 4; i += 1) append('c348', -6);
  return {
    version: 2, name: `${trainType.toUpperCase()} on a curved incline`, carCount, trainType,
    accessories: [], tracks: [approach, ...tracks.filter(track => track !== approach)],
  };
}

async function open(page: Page) {
  await page.goto('/');
  await expect(scene(page)).toHaveAttribute('data-ready', 'true');
}

async function seed(page: Page, layout: object) {
  await page.addInitScript(value => {
    if (!localStorage.getItem('little-railways-layout-v4') && !localStorage.getItem('little-railways-layout-v2')) localStorage.setItem('little-railways-layout-v2', JSON.stringify(value));
  }, layout);
  await open(page);
}

async function saved(page: Page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY);
}

async function importLayout(page: Page, layout: object) {
  await page.getByLabel('Open railway file').setInputFiles({ name: 'shinkansen-railway.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(layout)) });
}

async function saveNamed(page: Page, name: string) {
  await page.getByRole('button', { name: 'Save layout', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save your railway', exact: true });
  await dialog.getByRole('textbox', { name: 'Layout name', exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Save layout', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function freeze(page: Page) {
  const time = new Date('2026-01-01T00:00:00Z');
  await page.clock.install({ time });
  await page.clock.pauseAt(time);
}

async function advance(page: Page, milliseconds: number) {
  // Railway movement caps a long frame gap at 100 ms.
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 100) await page.clock.fastForward(Math.min(100, milliseconds - elapsed));
  await page.clock.fastForward(16);
}

async function rendered(page: Page) {
  return scene(page).evaluate(element => {
    const data = (element as HTMLCanvasElement).dataset;
    return { cars: JSON.parse(data.carPoses ?? '[]') as Car[], couplers: JSON.parse(data.couplers ?? '[]') as Coupling[] };
  });
}

function railSamples(tracks: Track[]) {
  return tracks.flatMap(track => pathsFor(track).flatMap(path => {
    const steps = Math.ceil(path.length);
    return Array.from({ length: steps + 1 }, (_, index) => {
      const point = path.pointAt(path.length * index / steps);
      return { ...point, z: point.z + 7.35 };
    });
  }));
}

function expectFormation(value: Awaited<ReturnType<typeof rendered>>, type: TrainType, count: number, rails: Point[]) {
  const train = getTrainSpec(type);
  expect(value.cars).toHaveLength(count);
  expect(value.couplers).toHaveLength(count - 1);
  for (const car of value.cars) {
    const spec = getTrainCarSpec(type, car.index, count);
    expect(car.visible, `Car ${car.index + 1} is on the railway`).toBe(true);
    expect(car.model).toBe(train.model);
    expect(car.length).toBeCloseTo(spec.length, 3);
    expect(car.bogieOffset).toBeCloseTo(spec.bogieOffset, 3);
    expect(car.scale).toBe(train.scale);
    expect(car.cab).toBe(car.index === 0 || car.index === count - 1);
    if (type !== 'e235') {
      expect(car.noseLength).toBeCloseTo(spec.noseLength, 3);
      expect(car.noseDirection).toBe(car.index === 0 ? 1 : car.index === count - 1 ? -1 : 0);
    }
    expect(gap(car.frontBogie, car.rearBogie), 'Bogies retain the fixed rigid chord').toBeCloseTo(spec.bogieOffset * 2, 1);
    expect(gap(car.frontEnd, car.rearEnd), 'The body keeps its actual length on a bend and grade').toBeCloseTo(spec.length, 1);
    const bodyVector = { x: car.frontEnd.x - car.rearEnd.x, y: car.frontEnd.y - car.rearEnd.y, z: car.frontEnd.z - car.rearEnd.z };
    const chord = { x: car.frontBogie.x - car.rearBogie.x, y: car.frontBogie.y - car.rearBogie.y, z: car.frontBogie.z - car.rearBogie.z };
    const ratio = spec.bogieOffset * 2 / spec.length;
    expect(gap({ x: bodyVector.x * ratio, y: bodyVector.y * ratio, z: bodyVector.z * ratio }, chord), 'Rigid shell follows the bogie chord').toBeLessThan(.05);
    expect(gap(car.center, {
      x: (car.frontBogie.x + car.rearBogie.x) / 2,
      y: (car.frontBogie.y + car.rearBogie.y) / 2,
      z: (car.frontBogie.z + car.rearBogie.z) / 2,
    })).toBeLessThan(.05);
    for (const bogie of [car.frontBogie, car.rearBogie]) expect(Math.min(...rails.map(point => gap(point, bogie))), 'Both bogies follow real rail paths').toBeLessThan(.55);
  }
  for (const coupling of value.couplers) {
    const leading = value.cars[coupling.index], following = value.cars[coupling.index + 1];
    expect(coupling.visible).toBe(true);
    expect(gap(coupling.front, { ...leading.rearBogie, z: leading.rearBogie.z + 3.45 }), 'Actual drawbar meets first bogie pin').toBeLessThan(.05);
    expect(gap(coupling.rear, { ...following.frontBogie, z: following.frontBogie.z + 3.45 }), 'Actual drawbar meets next bogie pin').toBeLessThan(.05);
    expect(gap(coupling.front, coupling.rear), 'Coupling retains its train-specific length').toBeCloseTo(getCouplingLinkLength(type, coupling.index, count), 1);
    expect(gap(coupling.frontGangway, leading.rearGangway)).toBeLessThan(.05);
    expect(gap(coupling.rearGangway, following.frontGangway)).toBeLessThan(.05);
    expect(gap(leading.rearEnd, following.frontEnd), 'Adjacent bodies retain a connected gap').toBeLessThan(12);
  }
}

for (const type of ['e5', 'e6', 'e7'] as const) {
  test(`${type.toUpperCase()} is selectable with two outward cabs, distinctive geometry, and a visible close-up`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await freeze(page);
    const layout = straightFixture();
    await seed(page, layout);
    await expect(selector(page)).toHaveValue('e235');
    await selector(page).selectOption(type);
    await advance(page, 100);
    await expect(scene(page)).toHaveAttribute('data-train-type', type);
    expect((await saved(page)).trainType).toBe(type);
    expectFormation(await rendered(page), type, 3, railSamples(layout.tracks));
    const formationPath = testInfo.outputPath(`${type}-three-car-formation.png`);
    await scene(page).screenshot({ path: formationPath });
    await testInfo.attach(`${type}-three-car-formation`, { path: formationPath, contentType: 'image/png' });
    await page.getByRole('button', { name: 'Train view', exact: true }).click();
    await advance(page, 200);
    const nosePath = testInfo.outputPath(`${type}-nose-close-up.png`);
    await scene(page).screenshot({ path: nosePath });
    await testInfo.attach(`${type}-nose-close-up`, { path: nosePath, contentType: 'image/png' });
    expect(errors).toEqual([]);
  });

  for (const count of [3, 11] as const) {
    test(`${type.toUpperCase()} ${count}-car formation keeps rigid cars and couplings through a curved grade and reverses without teleporting`, async ({ page }) => {
      await freeze(page);
      const layout = curvedGradeFixture(type, count);
      const rails = railSamples(layout.tracks);
      await seed(page, layout);
      await expect(selector(page)).toHaveValue(type);
      await advance(page, 100);
      expectFormation(await rendered(page), type, count, rails);
      await page.getByRole('slider', { name: 'Train speed' }).focus();
      await page.keyboard.press('End');
      await page.getByRole('button', { name: 'Run train', exact: true }).click();
      let previous = await rendered(page);
      for (let step = 0; step < 10; step += 1) {
        await advance(page, 250);
        const value = await rendered(page);
        expectFormation(value, type, count, rails);
        for (const car of value.cars) {
          expect(gap(car.center, previous.cars[car.index].center), 'A running car advances continuously').toBeLessThan(80);
          const dot = Math.abs(car.quaternion.reduce((sum, q, index) => sum + q * previous.cars[car.index].quaternion[index], 0));
          expect(dot, 'Car heading changes smoothly').toBeGreaterThan(Math.cos(Math.PI / 6));
        }
        previous = value;
      }
      await page.getByRole('button', { name: 'Pause train', exact: true }).click();
      await advance(page, 100);
      const paused = await rendered(page);
      expect(paused.cars[0].frontBogie.z, 'The leading car reaches the elevated curve').toBeGreaterThan(8);
      expect(paused.cars[0].frontBogie.z).toBeGreaterThan(paused.cars[0].rearBogie.z);
      const headings = paused.cars.map(car => Math.atan2(car.frontEnd.y - car.rearEnd.y, car.frontEnd.x - car.rearEnd.x));
      expect(Math.max(...headings) - Math.min(...headings), 'Formation spans the curve').toBeGreaterThan(.15);
      await page.getByRole('button', { name: 'Reverse train direction' }).click();
      await advance(page, 100);
      expect(await rendered(page), 'Direction selection does not move the current formation').toEqual(paused);
      await page.getByRole('button', { name: 'Run train', exact: true }).click();
      await advance(page, 250);
      const reversed = await rendered(page);
      expectFormation(reversed, type, count, rails);
      const before = paused.cars[0], after = reversed.cars[0];
      expect(gap(after.center, before.center)).toBeGreaterThan(5);
      expect(gap(after.center, before.center)).toBeLessThan(80);
      expect((after.center.x - before.center.x) * (before.frontEnd.x - before.rearEnd.x)
        + (after.center.y - before.center.y) * (before.frontEnd.y - before.rearEnd.y)).toBeLessThan(0);
    });
  }
}

test('changing a stopped train model preserves its rail cursor and the railway, and restores Yamanote rendering', async ({ page }) => {
  await freeze(page);
  const layout = curvedGradeFixture('e235', 3);
  await seed(page, layout);
  const original = await saved(page);
  await page.getByRole('button', { name: 'Run train', exact: true }).click();
  await advance(page, 500);
  await expect(selector(page)).toBeDisabled();
  await page.getByRole('button', { name: 'Pause train', exact: true }).click();
  await advance(page, 100);
  const stopped = await saved(page);
  const stoppedRendering = await rendered(page);
  await selector(page).selectOption('e5');
  await advance(page, 100);
  await expect(page.getByRole('button', { name: 'Run train', exact: true })).toBeVisible();
  expect((await saved(page)).tracks).toEqual(original.tracks);
  expect((await saved(page)).accessories).toEqual(original.accessories);
  expect((await saved(page)).carCount).toBe(3);
  const parked = await rendered(page);
  expect((await saved(page)).trains[0].position, 'A model change preserves its existing rail cursor').toEqual(stopped.trains[0].position);
  // The persisted cursor represents the nominal leading shell end. Bogies
  // sit farther behind that end on the longer E5 cab; keeping the bogie
  // fixed would instead relocate the saved train reference.
  expect(gap(parked.cars[0].frontEnd, stoppedRendering.cars[0].frontEnd), 'A longer cab retains its leading end on this straight approach').toBeLessThan(.05);
  await advance(page, 500);
  expect(await rendered(page)).toEqual(parked);
  await selector(page).selectOption('e235');
  await advance(page, 100);
  await expect(scene(page)).toHaveAttribute('data-train-type', 'e235');
  expectFormation(await rendered(page), 'e235', 3, railSamples(layout.tracks));
});

test('train choice survives browser reload, independent named layouts, file backup, import, undo, and legacy saves', async ({ page }, testInfo) => {
  const layout = straightFixture();
  await seed(page, layout);
  await expect(selector(page)).toHaveValue('e235');
  await selector(page).selectOption('e5');
  await saveNamed(page, 'Our green Shinkansen');
  await importLayout(page, { ...layout, trainType: 'e7' });
  await saveNamed(page, 'Our blue Shinkansen');
  const library = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), LIBRARY_KEY);
  expect(library.designs.map((design: { layout: { trainType: string } }) => design.layout.trainType).sort()).toEqual(['e5', 'e7']);
  await selector(page).selectOption('e6');
  await expect(selector(page)).toHaveValue('e6');
  await page.reload();
  await expect(scene(page)).toHaveAttribute('data-ready', 'true');
  await expect(selector(page)).toHaveValue('e6');
  await expect(scene(page)).toHaveAttribute('data-train-type', 'e6');
  await page.getByRole('button', { name: 'Layouts', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Open saved layout Our green Shinkansen', exact: true }).click();
  await expect(selector(page)).toHaveValue('e5');
  await selector(page).selectOption('e6');
  await page.getByRole('button', { name: 'Undo last change', exact: true }).click();
  await expect(selector(page)).toHaveValue('e5');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save a layout file', exact: true }).click();
  const download = await downloadPromise;
  const path = testInfo.outputPath('our-green-shinkansen.json');
  await download.saveAs(path);
  const exported = JSON.parse(await readFile(path, 'utf8'));
  expect(exported.trainType).toBe('e5');
  expect(exported.savedDesignId).toBeUndefined();
  await selector(page).selectOption('e7');
  await page.getByLabel('Open railway file').setInputFiles(path);
  await expect(selector(page)).toHaveValue('e5');
  expect((await saved(page)).tracks).toEqual(layout.tracks);
  await importLayout(page, layout);
  await expect(selector(page)).toHaveValue('e235');
  await expect(scene(page)).toHaveAttribute('data-train-type', 'e235');
  await page.reload();
  await expect(scene(page)).toHaveAttribute('data-ready', 'true');
  await expect(selector(page)).toHaveValue('e235');
});

test('train dropdown works with a keyboard and fits a 390-pixel screen for every train', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page, straightFixture());
  const train = selector(page);
  await expect(train).toHaveValue('e235');
  await train.focus();
  await page.keyboard.press('End');
  await expect(train).toHaveValue('e7');
  await page.keyboard.press('Home');
  await expect(train).toHaveValue('e235');
  for (const type of ['e5', 'e6', 'e7', 'e235']) {
    await train.selectOption(type);
    await expect(scene(page)).toHaveAttribute('data-train-type', type);
    await expect(train).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${type} selection stays within a small screen`).toBe(true);
    await page.getByRole('combobox', { name: 'Train car count', exact: true }).selectOption('11');
    await expect(page.getByRole('combobox', { name: 'Train car count', exact: true })).toHaveValue('11');
  }
});
