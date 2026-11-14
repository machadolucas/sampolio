import { readFileSync } from 'node:fs';
import { test, expect, type Page } from './fixtures';
import type { Locator } from '@playwright/test';

function fixture(): { groupId: string; linkedAccountId: string } {
  return JSON.parse(readFileSync('test-results/synthetic.json', 'utf8'));
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function reachable(page: Page, dialog: Locator, top: number, bottom: number) {
  const close = dialog.getByRole('button', { name: 'Close dialog', exact: true });
  const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
  // Dynamic viewport units settle after resize/focus, particularly in mobile
  // emulation. Check the resulting geometry rather than the intermediate frame.
  await expect.poll(async () => (await close.boundingBox())?.y ?? -Infinity).toBeGreaterThanOrEqual(top);
  await expect.poll(async () => {
    const bounds = await cancel.boundingBox();
    return bounds ? bounds.y + bounds.height : Infinity;
  }).toBeLessThanOrEqual(page.viewportSize()!.height - bottom);
  const closeBox = (await close.boundingBox())!;
  const cancelBox = (await cancel.boundingBox())!;
  expect(closeBox.width).toBeGreaterThanOrEqual(48);
  expect(closeBox.height).toBeGreaterThanOrEqual(48);
  expect(closeBox.y).toBeGreaterThanOrEqual(top);
  expect(cancelBox.y + cancelBox.height).toBeLessThanOrEqual(page.viewportSize()!.height - bottom);
  await close.click({ trial: true });
  await cancel.click({ trial: true });
  await expect(dialog.locator('.ui-dialog-content').getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);
  await noOverflow(page);
}

test('quick-add keeps dismissal outside the scrolling form and below safe areas', async ({ page }) => {
  const mobile = test.info().project.name === 'mobile';
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', {
    insets: { top: mobile ? 59 : 0, bottom: mobile ? 34 : 0, left: 0, right: 0 },
  });
  await page.goto(`/split/${fixture().groupId}`);
  const open = page.getByRole('button', { name: 'Add shared expense', exact: true }).filter({ visible: true });
  await open.click();
  const dialog = page.getByRole('dialog', { name: 'Add expense', exact: true });
  await dialog.getByPlaceholder('What was it for?').fill(`Synthetic discarded draft ${test.info().project.name}`);
  await dialog.getByPlaceholder('0,00').fill('34,56');
  await dialog.getByRole('button', { name: 'More options (date, category)', exact: true }).click();
  await reachable(page, dialog, mobile ? 59 : 0, mobile ? 34 : 0);
  await dialog.locator('.ui-dialog-content').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await reachable(page, dialog, mobile ? 59 : 0, mobile ? 34 : 0);
  await page.screenshot({ path: test.info().outputPath('split-quick-add-safe-area.png') });
  if (mobile) {
    await page.setViewportSize({ width: 390, height: 520 });
    await dialog.getByPlaceholder('What was it for?').focus();
    await reachable(page, dialog, 59, 34);
  }
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(dialog).toBeHidden();
  await open.click();
  await expect(dialog.getByPlaceholder('What was it for?')).toHaveValue('');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(page.getByText(`Synthetic discarded draft ${test.info().project.name}`, { exact: true })).toHaveCount(0);
});

test('full merchant names wrap and either deletion entry point confirms safely', async ({ page }) => {
  const title = `Synthetic ${test.info().project.name} merchant with a long company name and ${'Unbroken'.repeat(9)}`;
  await page.goto(`/split/${fixture().groupId}`);
  await page.getByRole('button', { name: 'Add expense', exact: true }).click();
  const add = page.getByRole('dialog', { name: 'Add expense', exact: true });
  await add.getByLabel('Description', { exact: true }).fill(title);
  await add.getByLabel('Amount', { exact: true }).fill('34,56');
  await expect(add.getByRole('button', { name: 'Delete expense', exact: true })).toHaveCount(0);
  await add.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(add).toBeHidden();
  const row = page.locator('[data-expense-id]').filter({ hasText: title });
  const name = row.getByText(title, { exact: true });
  await expect(name).toBeVisible();
  expect(await name.evaluate(element => {
    const style = getComputedStyle(element);
    return style.whiteSpace !== 'nowrap' && style.textOverflow !== 'ellipsis' && element.scrollWidth <= element.clientWidth;
  })).toBe(true);
  await noOverflow(page);
  await row.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('split-full-merchant-name.png') });
  await row.getByRole('button', { name: 'Row actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Delete entry?', exact: true });
  await expect(confirm).toContainText(title);
  await expect(confirm.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(row).toBeVisible();
  await expect(row.getByRole('button', { name: 'Row actions', exact: true })).toBeFocused();
  await row.getByRole('button').first().click();
  const edit = page.getByRole('dialog', { name: 'Edit expense', exact: true });
  await reachable(page, edit, 0, 0);
  await edit.getByLabel('Description', { exact: true }).fill('Synthetic unsaved change');
  await edit.getByRole('button', { name: 'Delete expense', exact: true }).click();
  await expect(confirm).toContainText(title);
  await expect(confirm).not.toContainText('Synthetic unsaved change');
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(edit.getByLabel('Description', { exact: true })).toHaveValue('Synthetic unsaved change');
  await expect(edit.getByRole('button', { name: 'Delete expense', exact: true })).toBeFocused();
  await edit.getByRole('button', { name: 'Delete expense', exact: true }).click();
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(edit).toBeHidden();
  await expect(row).toHaveCount(0);
  await page.reload();
  await expect(row).toHaveCount(0);
});

test('a member deletes a linked expense while the original bank transaction stays', async ({ page, browser }) => {
  const project = test.info().project.name;
  const transactionIndex: Record<string, number> = { desktop: 2, tablet: 3, mobile: 4 };
  const title = `Synthetic purchase ${transactionIndex[project]}`;
  await page.goto(`/bank?account=${fixture().linkedAccountId}`);
  await page.getByRole('textbox', { name: 'Search transactions', exact: true }).fill(title);
  const row = page.locator('[class*="bank-tx-row-"]:visible').filter({ has: page.getByText(title, { exact: true }) }).first();
  await row.getByRole('button', { name: 'Split this', exact: true }).click();
  const add = page.getByRole('dialog', { name: 'Add expense', exact: true });
  await expect(add.getByPlaceholder('What was it for?')).toHaveValue(title);
  await add.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(add).toBeHidden();
  await expect(row.getByRole('button', { name: 'split', exact: true })).toBeVisible();

  const sam = await browser.newContext({
    baseURL: 'http://localhost:4999',
    viewport: page.viewportSize()!,
    isMobile: project === 'mobile',
    hasTouch: project === 'mobile',
    reducedMotion: 'reduce',
    extraHTTPHeaders: { 'x-forwarded-for': '2001:db8:feed:de1e::1' },
  });
  try {
    const response = await sam.request.post('/api/auth/sign-in/email', {
      headers: { Origin: 'http://localhost:4999' },
      data: { email: 'sam@example.com', password: 'Synthetic-Only-2026!' },
    });
    expect(response.ok()).toBe(true);
    const samPage = await sam.newPage();
    await samPage.goto(`/split/${fixture().groupId}`);
    const expense = samPage.locator('[data-expense-id]').filter({ hasText: title });
    await expense.getByRole('button').first().click();
    const edit = samPage.getByRole('dialog', { name: 'Edit expense', exact: true });
    await edit.getByRole('button', { name: 'Delete expense', exact: true }).click();
    const confirm = samPage.getByRole('alertdialog', { name: 'Delete entry?', exact: true });
    await expect(confirm).toContainText('The original bank transaction will remain.');
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(edit).toBeHidden();
    await expect(expense).toHaveCount(0);
    await expect(row.getByRole('button', { name: 'split', exact: true })).toHaveCount(0);
    await expect(row.getByText(title, { exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole('textbox', { name: 'Search transactions', exact: true }).fill(title);
    await expect(row.getByText(title, { exact: true })).toBeVisible();
    await expect(row.getByRole('button', { name: 'split', exact: true })).toHaveCount(0);
  } finally {
    await sam.close();
  }
});
