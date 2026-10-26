import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from './fixtures';

async function readable(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter(v => ['serious', 'critical'].includes(v.impact ?? ''))).toEqual([]);
}
for (const theme of ['light', 'dark'] as const) {
  test.describe(`material polish ${theme}`, () => {
    test.use({ colorScheme: theme });
    test('multiple bank accounts stay inside their rail and ledger/month surfaces have integrated corners', async ({ page }) => {
      await page.goto('/bank');
      const rail = page.getByRole('region', { name: 'Bank and account selection' });
      const scroll = page.locator('[data-slot="bank-account-scroll"]');
      await expect(scroll.getByRole('button')).toHaveCount(4);
      const bounds = (await scroll.boundingBox())!;
      const railBounds = (await rail.boundingBox())!;
      expect(bounds.x).toBeGreaterThan(railBounds.x);
      expect(bounds.x + bounds.width).toBeLessThan(railBounds.x + railBounds.width);
      if (page.viewportSize()!.width < 1024) {
        expect(await scroll.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
      }
      for (const button of await page.locator('[data-slot="bank-connection-scroll"]').getByRole('button').all()) {
        expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      const last = scroll.getByRole('button', { name: /Synthetic long household reserve account/ });
      await last.scrollIntoViewIfNeeded();
      await last.click();
      await expect(last).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('main')).toContainText('Synthetic long household reserve account');
      const first = scroll.getByRole('button', { name: /Synthetic current account/ });
      await first.scrollIntoViewIfNeeded();
      await first.click();
      await expect(first).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('textbox', { name: 'Search transactions' })).toBeVisible();
      if (page.viewportSize()!.width >= 1024) {
        const frame = page.locator('[data-slot="table-surface"]').filter({ visible: true });
        await expect(frame).toHaveCSS('overflow', 'hidden');
        expect(await frame.evaluate(el => parseFloat(getComputedStyle(el).borderTopLeftRadius))).toBeGreaterThanOrEqual(16);
        const columns = frame.getByRole('button', { name: 'Choose optional columns' });
        const box = (await columns.boundingBox())!;
        const frameBox = (await frame.boundingBox())!;
        expect(box.x + box.width).toBeLessThan(frameBox.x + frameBox.width - 4);
        await expect(frame.locator('[data-slot="table-scroll"]')).toHaveCSS('overflow', 'auto');
      } else {
        const heading = page.locator('[data-slot="bank-month-heading"]').first();
        await expect(heading).toBeVisible();
        expect(await heading.evaluate(el => parseFloat(getComputedStyle(el).borderTopLeftRadius))).toBeGreaterThanOrEqual(12);
      }
      await readable(page);
      await page.screenshot({ path: test.info().outputPath('bank-contained.png') });
      const { groupId } = JSON.parse(readFileSync('test-results/synthetic.json', 'utf8'));
      await page.goto(`/split/${groupId}`);
      const heading = page.locator('[data-slot="split-month-heading"]').first();
      await expect(heading).toBeVisible();
      expect(await heading.evaluate(el => parseFloat(getComputedStyle(el).borderTopLeftRadius))).toBeGreaterThanOrEqual(12);
      expect(await heading.evaluate(el => parseFloat(getComputedStyle(el).paddingLeft))).toBeGreaterThanOrEqual(12);
      await heading.scrollIntoViewIfNeeded();
      await readable(page);
      await page.screenshot({ path: test.info().outputPath('split-month-heading.png') });
    });
    test('every bottom-nav selection shares the exact cell center and mobile toolbar separates glass from controls', async ({ page }) => {
      test.skip(page.viewportSize()!.width >= 1024, 'Mobile navigation only');
      await page.goto('/');
      const nav = page.locator('[data-slot="bottom-nav"]').filter({ visible: true });
      const indicator = nav.locator('[data-slot="bottom-nav-indicator"]');
      await expect(nav).toBeVisible();
      const urls = await nav.getByRole('link').evaluateAll(links => links.map(link => link.getAttribute('href')!));
      expect(urls.length).toBeGreaterThanOrEqual(1);
      for (const url of urls) {
        const link = nav.locator(`a[href="${url}"]`);
        await link.click();
        await expect(link).toHaveAttribute('aria-current', 'page');
        await expect.poll(async () => {
          const a = (await indicator.boundingBox())!;
          const b = (await link.boundingBox())!;
          return Math.max(Math.abs(a.x + a.width / 2 - b.x - b.width / 2), Math.abs(a.y + a.height / 2 - b.y - b.height / 2));
        }).toBeLessThan(0.75);
      }
      await nav.locator('a[href="/"]').click();
      const top = page.locator('[data-slot="mobile-top-bar"]').filter({ visible: true });
      await expect(top).toHaveCSS('backdrop-filter', 'none');
      const material = top.locator('[data-slot="mobile-toolbar-material"]');
      await expect(material).not.toHaveCSS('backdrop-filter', 'none');
      await expect(material).toHaveCSS('clip-path', 'inset(0px round 16px)');
      const cap = top.locator('..').locator('[data-slot="mobile-safearea-cap"]');
      await expect(cap).toHaveCSS('backdrop-filter', 'none');
      await expect(cap).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await readable(page);
      await page.screenshot({ path: test.info().outputPath('mobile-home-chrome.png') });
    });
    test('settings switches retain identical geometry beside long labels', async ({ page }) => {
      for (const tab of ['general', 'admin']) {
        await page.goto(`/settings?tab=${tab}`);
        await expect(page.getByRole('tab', { selected: true })).toBeVisible();
        const switches = page.getByRole('switch').filter({ visible: true });
        await expect.poll(() => switches.count()).toBeGreaterThan(0);
        for (const toggle of await switches.all()) {
          const box = (await toggle.boundingBox())!;
          expect(box.width).toBe(48);
          expect(box.height).toBe(30);
          await expect(toggle).toHaveCSS('flex-shrink', '0');
        }
        await readable(page);
        await switches.first().evaluate(el => el.scrollIntoView({ block: 'center' }));
        await page.screenshot({ path: test.info().outputPath(`settings-switches-${tab}.png`) });
        await switches.last().evaluate(el => el.scrollIntoView({ block: 'center' }));
        await page.screenshot({ path: test.info().outputPath(`settings-switches-${tab}-last.png`) });
      }
    });
    test('modal scrim dims and blurs while accessibility appearance preferences remove blur', async ({ page }) => {
      await page.goto('/');
      await page.locator('[data-slot="home-projected-card"]').click();
      const scrim = page.locator('.ui-backdrop').filter({ visible: true }).last();
      await expect(scrim).toHaveCSS('backdrop-filter', 'blur(1px)');
      const alpha = await scrim.evaluate(el => Number(getComputedStyle(el).backgroundColor.match(/[\d.]+/g)!.at(-1)));
      expect(alpha).toBeGreaterThanOrEqual(0.5);
      await readable(page);
      await page.screenshot({ path: test.info().outputPath('modal-scrim.png') });
      await page.keyboard.press('Escape');
      await page.goto('/settings');
      await page.getByRole('switch', { name: 'Reduce transparency', exact: true }).click();
      await page.goto('/');
      await page.locator('[data-slot="home-projected-card"]').click();
      await expect(scrim).toHaveCSS('backdrop-filter', 'none');
      await page.keyboard.press('Escape');
      await page.goto('/settings');
      await page.getByRole('switch', { name: 'Reduce transparency', exact: true }).click();
      await page.emulateMedia({ contrast: 'more' });
      await page.goto('/');
      await page.locator('[data-slot="home-projected-card"]').click();
      await expect(scrim).toHaveCSS('backdrop-filter', 'none');
      await readable(page);
    });
  });
}
