import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from './fixtures';

async function inspect(page: Page, name: string) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter((item) => ['serious', 'critical'].includes(item.impact ?? ''))).toEqual([]);
  await page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });
}
async function cardColor(page: Page) {
  return page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.background = 'var(--card)';
    document.body.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  });
}
async function inspectTabs(page: Page) {
  const list = page.getByRole('tablist').first();
  expect(await list.evaluate((element) => parseFloat(getComputedStyle(element).borderRadius))).toBeGreaterThan(0);
  for (const tab of await list.getByRole('tab').all()) {
    expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  const selected = list.getByRole('tab', { selected: true });
  const railColor = await list.evaluate((element) => getComputedStyle(element).backgroundColor);
  await expect(selected).not.toHaveCSS('background-color', railColor);
  await expect(selected).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  for (const card of await page.locator('main .ui-card').filter({ visible: true }).all()) {
    await expect(card).toHaveCSS('backdrop-filter', 'none');
  }
}
for (const theme of ['light', 'dark'] as const) {
  test.describe(`complete material ${theme}`, () => {
    test.use({ colorScheme: theme });
    test('every settings tab retains a reachable capsule selection and opaque content', async ({ page }) => {
      test.setTimeout(120_000);
      const tabs = [
        ['general', 'General'], ['finance', 'Finance'], ['banking', 'Accounts & Banking'],
        ['data', 'Data & Storage'], ['admin', 'Admin'], ['account', 'Account'], ['about', 'About'],
      ];
      for (const [key, label] of tabs) {
        await page.goto(`/settings?tab=${key}`);
        await expect(page.getByRole('tab', { name: label, exact: true })).toHaveAttribute('aria-selected', 'true');
        await inspectTabs(page);
        if (key === 'general') {
          const contrast = await page.getByRole('switch', { name: 'Reduce transparency', exact: true }).evaluate((track) => {
            const luminance = (color: string) => {
              const rgb = color.match(/\d+(?:\.\d+)?/g)!.slice(0, 3).map(Number).map((value) => {
                const s = value / 255;
                return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
              });
              return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
            };
            const thumb = track.querySelector('.ui-switch-thumb')!;
            const a = luminance(getComputedStyle(track).backgroundColor);
            const b = luminance(getComputedStyle(thumb).backgroundColor);
            return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
          });
          expect(contrast).toBeGreaterThanOrEqual(3);
        }
        await inspect(page, `settings-${key}`);
      }
      const first = page.getByRole('tab', { name: 'General', exact: true });
      await first.focus();
      await page.keyboard.press('ArrowRight');
      await expect(page.getByRole('tab', { name: 'Finance', exact: true })).toBeFocused();
    });
    test('every mortgage tab retains its controls and readable content', async ({ page }) => {
      test.setTimeout(120_000);
      await page.goto('/mortgage');
      for (const label of ['Overview', 'Charts', 'Schedule', 'Tools']) {
        const tab = page.getByRole('tab', { name: label, exact: true });
        await tab.click();
        await expect(tab).toHaveAttribute('aria-selected', 'true');
        await inspectTabs(page);
        await inspect(page, `mortgage-${label.toLowerCase()}`);
      }
    });
    test('command palette separates its material header and solid results, and all page rails honor transparency and contrast preferences', async ({ page }) => {
      await page.goto('/settings');
      const toggle = page.getByRole('switch', { name: 'Reduce transparency', exact: true });
      await expect(toggle).not.toBeChecked();
      await page.getByRole('button', { name: /^Search(?: ⌘K)?$/ }).filter({ visible: true }).click();
      const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
      await expect(palette).toBeVisible();
      await expect(palette).toHaveCSS('backdrop-filter', 'none');
      await expect(palette.locator('.glass-chrome')).not.toHaveCSS('backdrop-filter', 'none');
      await expect(palette.getByRole('listbox')).toHaveCSS('backdrop-filter', 'none');
      await inspect(page, 'command-palette');
      await page.keyboard.press('Escape');
      await expect(palette).toBeHidden();
      await toggle.click();
      for (const route of ['/goals', '/bank', '/overview']) {
        await page.goto(route);
        const header = page.locator('[data-slot="page-header"]').filter({ visible: true });
        await expect(header).toBeVisible();
        await expect(header).toHaveCSS('backdrop-filter', 'none');
        await expect(header).toHaveCSS('background-color', await cardColor(page));
        await inspect(page, `${route.slice(1)}-solid`);
      }
      await page.goto('/settings');
      await toggle.click();
      await page.emulateMedia({ contrast: 'more' });
      await expect(page.locator('[data-slot="page-header"]').filter({ visible: true })).toHaveCSS('backdrop-filter', 'none');
      await inspect(page, 'settings-increased-contrast');
    });
    test('public authentication and offline states use readable material surfaces', async ({ page, context }) => {
      await context.clearCookies();
      for (const route of ['signin', 'signup', 'error']) {
        await page.goto(`/auth/${route}`);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(page.locator('.auth-brand-header')).not.toHaveCSS('backdrop-filter', 'none');
        await expect(page.locator('.auth-form-body')).toHaveCSS('backdrop-filter', 'none');
        await expect(page.locator('.auth-form-body')).toHaveCSS('background-color', await cardColor(page));
        await inspect(page, `auth-${route}`);
      }
      await page.goto('/offline.html');
      await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible();
      expect((await page.getByRole('button', { name: 'Retry' }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await inspect(page, 'offline');
    });
  });
}
