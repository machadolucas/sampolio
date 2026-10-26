import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './fixtures';
import { readFileSync } from 'node:fs';

function fixture(): { accountId: string } {
  return JSON.parse(readFileSync('test-results/synthetic.json', 'utf8'));
}
async function expectAccessibleModal(page: Page) {
  const report = await new AxeBuilder({ page }).analyze();
  expect(
    report.violations.filter((violation) =>
      ['serious', 'critical'].includes(violation.impact ?? ''),
    ),
  ).toEqual([]);
}
async function command(page: Page, query: string, name: RegExp) {
  await page
    .getByRole('button', { name: /^Search(?: ⌘K)?$/ })
    .filter({ visible: true })
    .click();
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByRole('combobox').fill(query);
  await palette.getByRole('option', { name }).click();
  await expect(palette).toBeHidden();
}
async function savePreference(page: Page, click: () => Promise<void>) {
  const response = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.request().headers()['next-action'] !== undefined,
  );
  await click();
  await response;
}

async function ensureAdvanced(page: Page) {
  await page.goto('/settings');
  await savePreference(page, () =>
    page.getByRole('button', { name: /^Advanced / }).click(),
  );
  await expect(
    page.locator('[data-display-mode]').filter({ visible: true }),
  ).toHaveAttribute('data-display-mode', 'advanced');
  await expect(
    page.getByRole('tab', { name: 'Data & Storage', exact: true }),
  ).toBeVisible();
}
async function restorePreferences(page: Page) {
  await ensureAdvanced(page);
  const reset = page.getByRole('button', {
    name: 'Reset to default',
    exact: true,
  });
  if (await reset.isVisible()) await savePreference(page, () => reset.click());
  const dark = page.getByRole('switch', { name: 'Dark Mode', exact: true });
  if (await dark.isChecked()) await dark.click();
  const transparency = page.getByRole('switch', {
    name: 'Reduce transparency',
    exact: true,
  });
  if (await transparency.isChecked()) await transparency.click();
}

test('cashflow saves typed money on Enter, then preserves nested selector and cancellation', async ({
  page,
}) => {
  const title = `Synthetic core cashflow ${test.info().project.name}`;
  await page.goto('/cashflow');
  await page.getByRole('button', { name: 'Add Expense', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Add Item', exact: true });
  await create.getByLabel('Name', { exact: true }).fill(title);
  await create.getByLabel('Amount (EUR)', { exact: true }).fill('12,34');
  await expectAccessibleModal(page);
  await page.keyboard.press('Enter');
  await expect(create).toBeHidden();
  await expect(page.getByText('Item created', { exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'View all items', exact: true })
    .click();
  const list = page.getByRole('dialog', {
    name: 'Cashflow Items',
    exact: true,
  });
  await list
    .getByRole('button', { name: `Edit ${title}`, exact: true })
    .filter({ visible: true })
    .click();
  const edit = page.getByRole('dialog', { name: 'Edit Item', exact: true });
  await expect(edit.getByLabel('Amount (EUR)', { exact: true })).toHaveValue(
    /12,34/,
  );
  await edit.getByLabel(/Category/).click();
  await page
    .getByRole('option', { name: 'Entertainment', exact: true })
    .click();
  await expect(edit.getByLabel(/Category/)).toContainText('Entertainment');
  await edit.getByRole('button', { name: 'Delete item', exact: true }).click();
  const confirm = page.getByRole('alertdialog', {
    name: 'Delete item',
    exact: true,
  });
  await expect(
    confirm.getByRole('button', { name: 'Yes', exact: true }),
  ).toBeFocused();
  await expectAccessibleModal(page);
  await confirm.getByRole('button', { name: 'No', exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(edit).toBeVisible();
  await expect(edit.getByLabel('Name', { exact: true })).toHaveValue(title);
  await edit.getByRole('button', { name: 'Delete item', exact: true }).click();
  await confirm.getByRole('button', { name: 'Yes', exact: true }).click();
  await expect(edit).toBeHidden();
  await expect(list.getByText(title, { exact: true })).toHaveCount(0);
});

test('monthly check-in keeps typed balances after an outside press', async ({
  page,
}) => {
  await page.goto('/overview');
  await command(page, 'Monthly Check-in', /Monthly Check-in/);
  const dialog = page.getByRole('dialog', {
    name: 'Monthly Check-in',
    exact: true,
  });
  await expect(dialog).toBeVisible();
  const continueButton = dialog.getByRole('button', {
    name: 'Continue',
    exact: true,
  });
  await expect(continueButton).toBeEnabled();
  await continueButton.click();
  const amount = dialog.getByLabel('Actual balance for Everyday account', {
    exact: true,
  });
  await amount.fill('2500,50');
  await page
    .locator('.ui-backdrop')
    .click({ position: { x: 5, y: 5 }, force: true });
  await expect(dialog).toBeVisible();
  await expect(amount).toHaveValue(/2.*500,50/);
  await expectAccessibleModal(page);
  await dialog
    .getByRole('button', { name: 'Close dialog', exact: true })
    .click();
  await expect(dialog).toBeHidden();
});

test('device appearance, display mode and mobile-navigation preferences remain reachable', async ({
  page,
}) => {
  try {
    await ensureAdvanced(page);
    const dark = page.getByRole('switch', { name: 'Dark Mode', exact: true });
    await dark.click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page
      .getByRole('switch', { name: 'Reduce transparency', exact: true })
      .click();
    await expect(page.locator('html')).toHaveAttribute(
      'data-reduce-transparency',
      '',
    );
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.goto('/overview');
    await page.goto('/settings');
    await expect(
      page.getByRole('switch', { name: 'Reduce transparency', exact: true }),
    ).toBeChecked();
    await savePreference(page, () =>
      page.getByRole('button', { name: /^Simple / }).click(),
    );
    await expect(
      page.locator('[data-display-mode]').filter({ visible: true }),
    ).toHaveAttribute('data-display-mode', 'simple');
    await expect(
      page.getByRole('tab', { name: 'Data & Storage', exact: true }),
    ).toHaveCount(0);
    await savePreference(page, () =>
      page.getByRole('button', { name: /^Advanced / }).click(),
    );
    await expect(
      page.getByRole('tab', { name: 'Data & Storage', exact: true }),
    ).toBeVisible();
    const home = page.getByRole('button', { name: 'Home', exact: true });
    await expect(home).toHaveAttribute('aria-pressed', 'true');
    await savePreference(page, () => home.click());
    await expect(home).toHaveAttribute('aria-pressed', 'false');
    await savePreference(page, () => home.click());
    await expect(home).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('switch', { name: 'Dark Mode', exact: true }).click();
    await page
      .getByRole('switch', { name: 'Reduce transparency', exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
  } finally {
    await restorePreferences(page);
  }
});

test('demo masking survives reload and never masks editable amounts', async ({
  page,
}) => {
  await page.goto('/cashflow');
  await command(page, 'demo', /Toggle demo mode/);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('demo-mode')))
    .toBe('1');
  await expect(page.getByRole('main')).toContainText('✱✱✱');
  await page.reload();
  await expect(page.getByRole('main')).toContainText('✱✱✱');
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  if ((page.viewportSize()?.width ?? 1280) < 1024) {
    const quickAdd = page.locator('header').getByRole('button', {
      name: 'Add shared expense',
      exact: true,
    });
    await expect(quickAdd).toBeVisible();
    const bounds = await quickAdd.boundingBox();
    expect(bounds?.width).toBeGreaterThanOrEqual(44);
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole('button', { name: 'Add Expense', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add Item', exact: true });
  await dialog.getByLabel('Amount (EUR)', { exact: true }).fill('45,67');
  await expect(dialog.getByLabel('Amount (EUR)', { exact: true })).toHaveValue(
    /45,67/,
  );
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page
    .getByRole('button', {
      name: 'Demo mode active — tap to show amounts',
      exact: true,
    })
    .filter({ visible: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('demo-mode')))
    .toBe('0');
  await expect(page.getByRole('main')).not.toContainText('✱✱✱');
});

test('synthetic backup exports and merges back with confirmation cancellation preserved', async ({
  page,
}) => {
  await ensureAdvanced(page);
  await page.getByRole('tab', { name: 'Data & Storage', exact: true }).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = await downloadEvent;
  const path = await download.path();
  expect(path).toBeTruthy();
  const payload = readFileSync(path!, 'utf8');
  const exported = JSON.parse(payload);
  expect(
    exported.entities.accounts.some(
      (account: { id: string }) => account.id === fixture().accountId,
    ),
  ).toBe(true);
  await page
    .locator('input[type="file"][accept=".json,application/json"]')
    .setInputFiles({
      name: 'synthetic-roundtrip.json',
      mimeType: 'application/json',
      buffer: Buffer.from(payload),
    });
  const dialog = page.getByRole('dialog', {
    name: 'Import backup',
    exact: true,
  });
  await expect(dialog).toContainText('synthetic-roundtrip.json');
  await dialog.getByRole('checkbox').check();
  await dialog
    .getByRole('button', { name: 'Replace all…', exact: true })
    .click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'No', exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('checkbox').uncheck();
  await dialog
    .getByRole('button', { name: 'Import (merge)', exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByText('Import complete', { exact: true }),
  ).toBeVisible();
});

test('a synthetic profile image can be cropped, saved and removed', async ({
  page,
}) => {
  await page.goto('/settings?tab=account');
  const account = page.getByRole('tabpanel', { name: 'Account', exact: true });
  await account
    .getByRole('button', { name: 'Change photo', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Profile picture',
    exact: true,
  });
  await dialog
    .locator('input[type="file"]')
    .setInputFiles('public/icons/icon-512.png');
  await expect(
    dialog.getByRole('slider', { name: 'Zoom', exact: true }),
  ).toBeVisible();
  await dialog.getByRole('slider', { name: 'Zoom', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(
    dialog.getByRole('button', { name: 'Save', exact: true }),
  ).toBeEnabled();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  const image = account.locator('img[src^="/api/avatars/"]');
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBe(256);
  await account
    .getByRole('button', { name: 'Change photo', exact: true })
    .click();
  await dialog
    .getByRole('button', { name: 'Remove photo', exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await expect(image).toHaveCount(0);
});

test('an empty synthetic account shows goal guidance', async ({ page }) => {
  await page.context().clearCookies();
  await page.goto('/auth/signin');
  const response = await page.request.post('/api/auth/sign-in/email', {
    headers: { Origin: new URL(page.url()).origin },
    data: { email: 'sam@example.com', password: 'Synthetic-Only-2026!' },
  });
  expect(response.ok()).toBe(true);
  await page.goto('/goals');
  await expect(
    page.getByText('Set your first goal', { exact: true }),
  ).toBeVisible();
  const emptyState = page
    .getByText('Set your first goal', { exact: true })
    .locator('..');
  await expect(
    emptyState.getByRole('button', { name: 'New goal', exact: true }),
  ).toBeVisible();
});

test('a delayed failed read shows loading then recovery without inventing an empty state', async ({
  page,
}) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/goals', async (route) => {
    if (
      route.request().method() === 'POST' &&
      route.request().headers()['next-action']
    ) {
      await pending;
      await route.abort('failed');
    } else await route.continue();
  });
  await page.goto('/goals');
  try {
    await expect(
      page.getByRole('status', { name: 'Loading', exact: true }),
    ).toBeVisible();
  } finally {
    release();
  }
  await expect(
    page.getByRole('button', { name: 'Retry', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Set your first goal', { exact: true }),
  ).toHaveCount(0);
  await page.unroute('**/goals');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(
    page.getByText('Synthetic reserve', { exact: true }),
  ).toBeVisible();
});
