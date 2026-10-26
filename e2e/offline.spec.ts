import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";

for (const theme of ["light", "dark"] as const) {
  test.describe(`offline saved ${theme}`, () => {
    test.use({ colorScheme: theme === "dark" ? "light" : "dark" });
    test("retains the saved theme, Retry target and viewport bounds", async ({
      page,
    }) => {
      await page.addInitScript(
        (theme) => localStorage.setItem("sampolio-theme", theme),
        theme,
      );
      await page.goto("/offline.html");
      await expect(
        page.getByRole("heading", { name: "You're offline", exact: true }),
      ).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const retry = page.getByRole("button", { name: "Retry", exact: true });
      await expect(retry).toBeVisible();
      const bounds = await retry.boundingBox();
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
      expect(bounds!.width).toBeGreaterThanOrEqual(44);
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true);
      const report = await new AxeBuilder({ page }).analyze();
      expect(
        report.violations.filter((item) =>
          ["serious", "critical"].includes(item.impact ?? ""),
        ),
      ).toEqual([]);
      await page.screenshot({ path: test.info().outputPath("offline.png") });
    });
  });
}
