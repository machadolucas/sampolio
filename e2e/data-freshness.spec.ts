import { readFileSync } from 'node:fs';
import { expect, test, type Page } from './fixtures';
import { formatYearMonth } from '@/lib/constants';

type SyntheticFixture = {
  groupId: string;
  linkedAccountId: string;
  expenseId: string;
};

function fixture(): SyntheticFixture {
  return JSON.parse(readFileSync('test-results/synthetic.json', 'utf8'));
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
}

async function previousMonthDate(page: Page) {
  return page.evaluate(() => {
    const date = new Date();
    date.setDate(1);
    date.setMonth(date.getMonth() - 1);
    return {
      value: `01.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`,
      month: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
    };
  });
}

test('same-window split saves update the backdated month, Activity, and settlement balance', async ({ page }) => {
  test.skip(test.info().project.name === 'tablet', 'Run freshness coverage at desktop and mobile widths');
  const data = fixture();
  const title = `Synthetic backdated freshness ${test.info().project.name}`;
  await page.goto(`/split/${data.groupId}`);
  await expect(page.locator(`[data-expense-id="${data.expenseId}"]`)).toBeVisible();

  const backdate = await previousMonthDate(page);
  await page.getByRole('button', { name: 'Add expense', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add expense', exact: true });
  await dialog.getByLabel('Description', { exact: true }).fill(title);
  await dialog.getByLabel('Amount', { exact: true }).fill('7,00');
  await dialog.getByRole('textbox', { name: 'Date', exact: true }).fill(backdate.value);
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog).toBeHidden();

  // The new month was absent from the initial month index. The saved row must
  // add it to the open ledger immediately, without waiting for a refetch.
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="split-month-heading"]').filter({ hasText: formatYearMonth(backdate.month) })).toBeVisible();

  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Expenses', exact: true }).click();

  await page.getByRole('button', { name: 'Settle up', exact: true }).click();
  const settle = page.getByRole('dialog', { name: 'Record a payment', exact: true });
  await expect(settle).toBeVisible();
  await settle.getByRole('button', { name: 'Record payment', exact: true }).click();
  await expect(settle).toBeHidden();
  await expect(page.getByText('You are all settled up', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await expect(page.getByText(/paid/).first()).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('split-after-settlement.png') });
  await expectNoHorizontalOverflow(page);
});

test('shared edits reach another open member while private changes stay scoped to their owner', async ({
  page,
  browser,
}) => {
  test.skip(test.info().project.name === 'tablet', 'Run freshness coverage at desktop and mobile widths');
  const data = fixture();
  const groupUrl = `/split/${data.groupId}`;
  const samContext = await browser.newContext({
    baseURL: 'http://localhost:4999',
    storageState: { cookies: [], origins: [] },
    viewport: page.viewportSize() ?? undefined,
    isMobile: test.info().project.name === 'mobile',
    hasTouch: test.info().project.name === 'mobile',
    extraHTTPHeaders: { 'x-forwarded-for': '2001:db8:feed:beef:cafe::1' },
  });
  const samPage = await samContext.newPage();
  try {
    await samPage.goto('/auth/signin');
    await samPage.getByLabel('Email', { exact: true }).fill('sam@example.com');
    await samPage.getByLabel('Password', { exact: true }).fill('Synthetic-Only-2026!');
    await samPage.keyboard.press('Enter');
    await expect(samPage).not.toHaveURL(/auth\/signin/);
    await samPage.goto(groupUrl);
    await expect(samPage.locator(`[data-expense-id="${data.expenseId}"]`)).toBeVisible();

    await samPage.evaluate(() => {
      const target = window as Window & {
        __freshnessEvents?: { revision: string; keys: string[] }[];
        __freshnessStream?: EventSource;
      };
      target.__freshnessEvents = [];
      target.__freshnessStream = new EventSource('/api/data-events');
      target.__freshnessStream.addEventListener('changed', (event) => {
        const payload = JSON.parse((event as MessageEvent<string>).data) as Record<string, unknown>;
        target.__freshnessEvents?.push({ revision: String(payload.revision), keys: Object.keys(payload).sort() });
      });
    });
    await expect.poll(() => samPage.evaluate(() => (window as Window & { __freshnessEvents?: unknown[] }).__freshnessEvents?.length ?? 0)).toBe(1);

    // Alex's preference write changes only user:Alex data. Sam's authenticated
    // stream must not learn that a private change happened.
    await page.goto('/settings?tab=general');
    const reminders = page.getByRole('switch', { name: 'Monthly check-in reminders', exact: true });
    await expect(reminders).toBeVisible();
    const reminderState = await reminders.isChecked();
    await reminders.click();
    await expect(reminders).toBeChecked({ checked: !reminderState });
    await page.waitForTimeout(750);
    await expect.poll(() => samPage.evaluate(() => (window as Window & { __freshnessEvents?: unknown[] }).__freshnessEvents?.length ?? 0)).toBe(1);

    // An edit in the shared group is visible to both memberships. Keep Sam's
    // split detail mounted and verify the open Expenses view updates in place.
    const updatedTitle = `Synthetic shared freshness ${test.info().project.name}`;
    await page.goto(groupUrl);
    const alexExpense = page.locator(`[data-expense-id="${data.expenseId}"]`);
    await expect(alexExpense).toBeVisible();
    await alexExpense.getByRole('button').first().click();
    const edit = page.getByRole('dialog', { name: 'Edit expense', exact: true });
    await edit.getByLabel('Description', { exact: true }).fill(updatedTitle);
    await edit.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(edit).toBeHidden();

    await expect.poll(() => samPage.evaluate(() => (window as Window & { __freshnessEvents?: unknown[] }).__freshnessEvents?.length ?? 0)).toBeGreaterThan(1);
    await expect(samPage.locator(`[data-expense-id="${data.expenseId}"]`)).toContainText(updatedTitle);
    const received = await samPage.evaluate(() => (window as Window & {
      __freshnessEvents?: { revision: string; keys: string[] }[];
    }).__freshnessEvents ?? []);
    expect(received.slice(1).every((event) => event.keys.join(',') === 'revision')).toBe(true);
    expect(received.slice(1).every((event) => /^[a-f0-9]{64}$/.test(event.revision))).toBe(true);
    await expectNoHorizontalOverflow(samPage);
    await expectNoHorizontalOverflow(page);
  } finally {
    await samContext.close();
  }
});

test('bank page shows the selected synthetic account successful-sync timestamp', async ({ page }) => {
  test.skip(test.info().project.name === 'tablet', 'Run freshness coverage at desktop and mobile widths');
  const data = fixture();
  await page.goto(`/bank?account=${data.linkedAccountId}`);
  await expect(page.getByText(/^Account last synced /)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('bank-status.png') });
  await expectNoHorizontalOverflow(page);
});
