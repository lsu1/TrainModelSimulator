import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Follow the public tool-panel flow rather than relying on hidden controls. */
export async function showPieces(page: Page) {
  await page.getByRole('tab', { name: 'Pieces', exact: true }).click();
}

export async function openMoreTools(page: Page) {
  await showPieces(page);
  const more = page.locator('details.builder-more');
  if (!await more.evaluate(element => (element as HTMLDetailsElement).open)) {
    await more.locator(':scope > summary').click();
  }
}

export async function editSelectedPiece(page: Page) {
  const editor = page.locator('#builder-panel-editor');
  if (!await editor.isVisible()) {
    await page.getByRole('button', { name: 'Edit selected piece', exact: true }).click();
  }
  await expect(editor).toBeVisible();
}
