import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { getTrainSpec } from '../src/trains';
import type { TrainType } from '../src/trains';

// These checks inspect the attached meshes; reference colour and roof-role
// geometry are covered separately by model tests and manual photo comparison.
test.setTimeout(120_000);
const scene = (page: Page) => page.getByRole('img', { name: '3D railway layout: rotate, zoom, select trains, and move Kato track pieces' });
const carCount = (page: Page) => page.getByRole('combobox', { name: 'Train car count', exact: true });
type Shinkansen = Exclude<TrainType, 'e235'>;
type Point = { x: number; y: number; z: number };
type RoofEquipment = {
  series: Shinkansen; prototypeCarNumber: number; prototypeFormation: boolean;
  pantograph: boolean; antennaStyle: string; roofRole: string;
  parts: string[]; antennaCenter?: Point; pantographCenter?: Point;
};
type Car = {
  index: number; visible: boolean; cab: boolean; noseDirection: number;
  center: Point; frontEnd: Point; rearEnd: Point; quaternion: [number, number, number, number];
  roofEquipment?: RoofEquipment;
  livery?: { primary: string; secondary: string; stripe: string; chin?: string };
};

function fixture(type: Shinkansen) {
  const trains = [{
    id: 'appearance-train', name: `${type.toUpperCase()} close-up`, type, carCount: 3,
    position: { trackId: 'appearance-9', distance: 18, direction: 1, route: 0, laps: 0 },
    cabForward: true, requestedSpeed: 65,
  }];
  return {
    version: 3, name: 'Shinkansen appearance review', trainType: type, carCount: 3,
    accessories: [], selectedTrainId: trains[0].id, trains,
    tracks: Array.from({ length: 16 }, (_, i) => ({
      id: `appearance-${i}`, kind: 's248', x: i * 248, y: 0, angle: 0,
      bend: 1, elevation: 0, endElevation: 0,
    })),
  };
}

async function seed(page: Page, type: Shinkansen) {
  const time = new Date('2026-01-01T00:00:00Z');
  await page.clock.install({ time });
  await page.clock.pauseAt(time);
  await page.addInitScript(value => localStorage.setItem('little-railways-layout-v3', JSON.stringify(value)), fixture(type));
  await page.goto('/');
  await expect(scene(page)).toHaveAttribute('data-ready', 'true');
}

async function advance(page: Page, milliseconds: number) {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 100) await page.clock.fastForward(Math.min(100, milliseconds - elapsed));
  await page.clock.fastForward(16);
}

async function cars(page: Page): Promise<Car[]> {
  return scene(page).evaluate(element => JSON.parse((element as HTMLCanvasElement).dataset.carPoses ?? '[]'));
}

const gap = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

async function capture(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await scene(page).screenshot({ path });
  await info.attach(name, { path, contentType: 'image/png' });
}

function checkAttachedRoofs(value: Car[], type: Shinkansen, count: number) {
  const spec = getTrainSpec(type);
  expect(value).toHaveLength(count);
  for (const car of value) {
    expect(car.visible).toBe(true);
    expect(car.livery?.primary).toBe(spec.colors.primary);
    expect(car.livery?.secondary).toBe(spec.colors.secondary);
    expect(car.livery?.stripe).toBe(spec.colors.stripe);
    if (type === 'e7' && car.cab) expect(car.livery?.chin).toBe(spec.colors.secondary);
    expect(car.roofEquipment?.series).toBe(type);
    expect(car.roofEquipment?.parts).toContain('roof-service-panel-seams');
    expect(car.roofEquipment?.parts).toContain('flush-roof-ventilation-grilles');
    // No generic raised capsule is carried forward from the old renderer.
    expect(car.roofEquipment?.parts).not.toContain('low-streamlined-roof-equipment');
    if (car.cab) {
      expect(car.roofEquipment?.parts).toContain('cab-radio-antenna');
      expect(car.roofEquipment?.antennaCenter).toBeDefined();
      expect(car.roofEquipment!.antennaCenter!.z - car.center.z).toBeGreaterThan(spec.height);
      expect(car.roofEquipment?.pantograph).toBe(false);
    }
    if (car.roofEquipment?.pantograph) {
      expect(car.roofEquipment.parts).toEqual(expect.arrayContaining(['pantograph-insulators', 'single-arm-pantograph', 'pantograph-contact-strip']));
      expect(car.roofEquipment.pantographCenter).toBeDefined();
      expect(car.roofEquipment.pantographCenter!.z - car.center.z).toBeGreaterThan(spec.height);
    }
  }
  const first = value[0], rear = value.at(-1)!;
  expect(first.noseDirection).toBe(1);
  expect(rear.noseDirection).toBe(-1);
  const firstOffset = first.roofEquipment!.antennaCenter!.x - first.center.x;
  const rearOffset = rear.roofEquipment!.antennaCenter!.x - rear.center.x;
  expect(firstOffset, 'Rear cab equipment mirrors the front cab with the exterior').toBeCloseTo(-rearOffset, 3);
  expect(value.filter(car => car.roofEquipment?.parts.includes('cab-radio-antenna'))).toHaveLength(2);
  expect(value.filter(car => car.roofEquipment?.pantograph)).toHaveLength(count === 3 ? 1 : 2);
}

for (const type of ['e5', 'e6', 'e7'] as const) {
  test(`${type.toUpperCase()} has attached roof details through formation changes, movement, and close-up cameras`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await seed(page, type);
    await advance(page, 100);
    checkAttachedRoofs(await cars(page), type, 3);

    await page.getByRole('button', { name: 'Train view', exact: true }).click();
    await advance(page, 300);
    await capture(page, info, `${type}-cab-oblique`);
    await page.getByRole('button', { name: 'Top view', exact: true }).click();
    await advance(page, 300);
    const box = (await scene(page).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -1800);
    await advance(page, 500);
    await capture(page, info, `${type}-roof-top`);

    await carCount(page).selectOption('11');
    await advance(page, 100);
    checkAttachedRoofs(await cars(page), type, 11);
    await carCount(page).selectOption('3');
    await advance(page, 100);
    const before = await cars(page);
    checkAttachedRoofs(before, type, 3);
    await page.getByRole('button', { name: 'Run train', exact: true }).click();
    await advance(page, 800);
    await page.getByRole('button', { name: 'Pause train', exact: true }).click();
    await advance(page, 100);
    const after = await cars(page);
    checkAttachedRoofs(after, type, 3);
    for (const [index, car] of after.entries()) {
      expect(gap(car.center, before[index].center), 'Train still travels normally').toBeGreaterThan(10);
      if (car.roofEquipment?.antennaCenter) {
        const old = before[index].roofEquipment!.antennaCenter!;
        expect(car.roofEquipment.antennaCenter.x - old.x, 'The antenna follows its rigid car').toBeCloseTo(car.center.x - before[index].center.x, 3);
        expect(car.roofEquipment.antennaCenter.z - old.z).toBeCloseTo(car.center.z - before[index].center.z, 3);
      }
    }
    await page.getByRole('button', { name: 'Reverse train direction', exact: true }).click();
    await advance(page, 100);
    expect(await cars(page), 'Reversing the stopped train preserves all rooftop attachment points').toEqual(after);
    expect(errors).toEqual([]);
  });
}
