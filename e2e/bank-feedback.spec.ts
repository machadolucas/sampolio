import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures';

test('bank cancellation opens banking settings with friendly feedback', async ({ page }) => {
  await page.goto('/api/bank/callback?error=access_denied&state=synthetic-cancel');
  await expect(page.getByRole('region', { name: 'Notifications' }).getByText('Bank connection cancelled. You can try again whenever you are ready.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Bank connections', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/settings\?tab=banking$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('technical bank failures never display provider error details', async ({ page }) => {
  await page.goto('/api/bank/callback?error=server_error&error_description=sensitive-example&state=synthetic-failure');
  await expect(page.getByRole('region', { name: 'Notifications' }).getByText('Could not connect your bank. Please try again.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Bank connections', exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('sensitive-example');
  await expect(page.locator('body')).not.toContainText('server_error');
  await expect(page).toHaveURL(/\/settings\?tab=banking$/);
});

test('reference review is visible without removing the saved ledger', async ({ page }) => {
  test.skip(process.env.SAMPOLIO_FIXTURE_REFERENCE_REVIEW !== '1', 'Requires isolated review fixture');
  const fixture = JSON.parse(readFileSync('test-results/synthetic.json', 'utf8'));
  await page.goto(`/bank?account=${fixture.linkedAccountId}`);
  await expect(page.getByText(/transaction may have changed its reference/)).toBeVisible();
  await expect(page.getByText('Synthetic purchase 2', { exact: true }).filter({ visible: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('bank-reference-review.png') });
});
