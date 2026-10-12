import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { KATO_CATALOG } from '../src/catalog'
import type { TrainSnapshot } from '../src/fleet'
import type { LayoutData } from '../src/layout'

// This whole-plan scene is deliberately exercised in one software-WebGL worker.
test.setTimeout(360_000)
const STORAGE_KEY = 'little-railways-layout-v5'
const NAME = '新干线与在来线交错运行'
const scene = (page: Page) => page.getByRole('img', { name: '3D railway layout: rotate, zoom, select trains, and move Kato track pieces' })
type Point = { x: number; y: number; z: number }
type RenderedTrain = TrainSnapshot & {
  running: boolean; actualSpeed: number; stopReason?: string;
  cars: { visible: boolean; center: Point }[];
  couplers: { visible: boolean }[];
}

async function freeze(page: Page) {
  const time = new Date('2026-10-11T00:00:00Z')
  await page.clock.install({ time })
  await page.clock.pauseAt(time)
}

async function advance(page: Page, milliseconds = 16) {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 100) {
    await page.clock.fastForward(Math.min(100, milliseconds - elapsed))
  }
  await page.clock.fastForward(16)
}

async function saved(page: Page): Promise<LayoutData> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY)
}

async function fleet(page: Page): Promise<RenderedTrain[]> {
  return scene(page).evaluate(element => JSON.parse((element as HTMLCanvasElement).dataset.fleetPoses ?? '[]'))
}

async function choose(page: Page, name: string) {
  await page.getByRole('button', { name: 'Layouts', exact: true }).click()
  const chooser = page.getByRole('dialog')
  await chooser.getByRole('combobox', { name: 'Choose a layout', exact: true }).selectOption({ label: name })
  await chooser.getByRole('button', { name: 'Open layout', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await advance(page)
}

test('the added KATO plan preserves the current railway and supports trains, turnout controls and station-name file round trips', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    if (/Encountered two children with the same key|unique ["']key["'] prop/.test(message.text())) {
      errors.push(message.text())
    }
  })
  await freeze(page)
  await page.goto('./')
  await expect(scene(page)).toHaveAttribute('data-ready', 'true', { timeout: 90_000 })
  await advance(page)
  const original = await saved(page)
  expect(original.sourcePlan).not.toBe('kato-plan06-15')
  await choose(page, NAME)
  await expect(page.getByRole('heading', { name: NAME, exact: true })).toBeVisible()
  await expect(scene(page)).toHaveAttribute('data-error-piece-ids', '[]')
  let layout = await saved(page)
  expect(layout.sourcePlan).toBe('kato-plan06-15')
  expect(layout.tracks).toHaveLength(294)
  expect(layout.tracks.filter(track => track.switchNumber)).toHaveLength(24)
  expect(layout.trains!.map(train => train.type)).toEqual(['e235', 'e5', 'e6'])
  await expect(page.getByRole('link', { name: 'View KATO plan', exact: true })).toHaveAttribute('href',
    'https://www.katomodels.com/unitrackplan/plan/plan06-15.pdf')
  await expect(page.getByRole('link', { name: 'Parts list', exact: true })).toHaveAttribute('href',
    'https://www.katomodels.com/unitrackplan/plan/plan06-15_partslist.pdf')
  await expect(page.getByRole('link', { name: 'Parts key', exact: true })).toHaveAttribute('href',
    'https://www.katomodels.com/unitrackplan/common_parts_namelist.pdf')
  await expect(page.getByRole('combobox', { name: 'Train', exact: true }).locator('option')).toHaveCount(4)

  // Opening a sample is undoable and never changes the existing startup layout.
  await page.getByRole('button', { name: 'Undo last change', exact: true }).click()
  await advance(page)
  expect(await saved(page)).toEqual(original)
  await choose(page, NAME)
  const parked = await fleet(page)
  expect(parked).toHaveLength(3)
  const selector = page.getByRole('group', { name: 'Select a train to drive', exact: true })
  for (const train of parked) {
    await selector.locator(`button[data-train-id="${train.id}"]`).click()
    await page.getByRole('button', { name: 'Run train', exact: true }).click()
    await advance(page, 100)
  }
  await advance(page, 1000)
  const moving = await fleet(page)
  for (const train of moving) {
    expect(train.running, `${train.name}: ${train.stopReason}`).toBe(true)
    expect(train.actualSpeed).toBeGreaterThan(0)
    expect(train.cars).toHaveLength(3)
    expect(train.cars.every(car => car.visible)).toBe(true)
    expect(train.couplers.every(coupler => coupler.visible)).toBe(true)
    const before = parked.find(value => value.id === train.id)!.cars[0].center
    const after = train.cars[0].center
    expect(Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z)).toBeGreaterThan(20)
    expect(after.z).toBeGreaterThanOrEqual(train.type === 'e235' ? 0 : 60)
    expect(after.z).toBeLessThan(train.type === 'e235' ? 10 : 70)
  }
  for (const train of moving) {
    await selector.locator(`button[data-train-id="${train.id}"]`).click()
    await page.getByRole('button', { name: 'Pause train', exact: true }).click()
  }
  await advance(page)
  const screenshot = info.outputPath('kato-plan06-complete-layout.png')
  await scene(page).screenshot({ path: screenshot })
  await info.attach('new-complete-layout', { path: screenshot, contentType: 'image/png' })

  layout = await saved(page)
  const named = layout.accessories.find(accessory => KATO_CATALOG.find(item => item.kind === accessory.kind)?.accessoryType === 'platform')!
  const item = KATO_CATALOG.find(value => value.kind === named.kind)!
  const inventory = page.locator('details.inventory')
  if (!await inventory.evaluate(element => (element as HTMLDetailsElement).open)) await inventory.locator('summary').click()
  await page.getByRole('button', { name: `Select placed ${item.name}`, exact: true }).first().click()
  await page.getByRole('textbox', { name: 'Station name', exact: true }).fill('新大阪 Shin-Osaka')
  await page.getByRole('button', { name: 'Apply station name', exact: true }).click()
  await advance(page)
  expect((await saved(page)).accessories.find(accessory => accessory.id === named.id)!.stationName).toBe('新大阪 Shin-Osaka')
  await expect.poll(() => scene(page).evaluate((element, id) =>
    JSON.parse((element as HTMLCanvasElement).dataset.stationSigns ?? '[]')
      .some((sign: { id: string; name: string }) => sign.id === id && sign.name === '新大阪 Shin-Osaka'), named.id)).toBe(true)

  // Remove only this test's stopped trains so the occupied-point guard remains
  // enabled while the actual control desk is checked on an unoccupied switch.
  for (const train of moving) {
    await selector.locator(`button[data-train-id="${train.id}"]`).click()
    await page.getByRole('button', { name: 'Remove selected train', exact: true }).click()
  }
  const desk = page.getByRole('region', { name: 'Turnout switch controls', exact: true })
  await expect(desk.getByRole('group')).toHaveCount(24)
  await desk.getByRole('button', { name: 'Switch 1 branch', exact: true }).click()
  await advance(page)
  await expect(desk.getByRole('button', { name: 'Switch 1 branch', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const beforeReload = await saved(page)
  await page.reload()
  await expect(scene(page)).toHaveAttribute('data-ready', 'true', { timeout: 90_000 })
  await advance(page)
  expect(await saved(page)).toEqual(beforeReload)
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save a layout file', exact: true }).click()
  const exportPath = info.outputPath('kato-plan06-with-custom-name.json')
  await (await downloadPromise).saveAs(exportPath)
  expect(JSON.parse(await readFile(exportPath, 'utf8'))).toEqual(beforeReload)
  await choose(page, 'A fresh adventure')
  await page.getByRole('button', { name: 'Layouts', exact: true }).click()
  await page.getByLabel('Open railway file', { exact: true }).setInputFiles(exportPath)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await advance(page)
  expect(await saved(page)).toEqual(beforeReload)
  await expect(page.getByRole('heading', { name: NAME, exact: true })).toBeVisible()
  await expect(scene(page)).toHaveAttribute('data-error-piece-ids', '[]')
  await expect(desk.getByRole('button', { name: 'Switch 1 branch', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Layouts', exact: true }).click()
  await expect(page.getByText('Start a new layout', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Start coupling practice', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await page.getByRole('button', { name: 'Catalog & model references', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'From Kato to your little world', exact: true })).toBeVisible()
  await expect(page.getByRole('dialog').locator('a[href="https://www.katomodels.com/unitrackplan/plan/plan06-15.pdf"]')).toHaveCount(1)
  expect(errors).toEqual([])
})
