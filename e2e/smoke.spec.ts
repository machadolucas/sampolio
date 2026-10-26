import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync, writeFileSync } from "node:fs";

const routes = [
  "/",
  "/overview",
  "/cashflow",
  "/bank",
  "/mortgage",
  "/budgets",
  "/goals",
  "/split",
  "/settings",
  "/playground",
  "/trips",
  "/budgets/fixture",
  "/split/fixture",
];
for (const theme of ["light", "dark"] as const) {
  test.describe(theme, () => {
    test.use({ colorScheme: theme });
    for (const path of routes) {
      test(`${path} renders without viewport overflow or serious accessibility violations`, async ({
        page,
      }) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
          if (
            message.type() === "error" &&
            /hydrat|render|uncaught|error boundary/i.test(message.text())
          )
            errors.push(message.text());
        });
        const fixture = JSON.parse(
          readFileSync("test-results/synthetic.json", "utf8"),
        );
        const destination =
          path === "/budgets/fixture"
            ? `/budgets/${fixture.budgetId}`
            : path === "/split/fixture"
              ? `/split/${fixture.groupId}`
              : path;
        await page.goto(destination);
        await expect(page.getByRole("main")).toBeVisible();
        await expect(
          page.getByRole("main").getByRole("heading").first(),
        ).toBeVisible();
        if (theme === "dark")
          await expect(page.locator("html")).toHaveClass(/dark/);
        else await expect(page.locator("html")).not.toHaveClass(/dark/);
        await expect(
          page.getByText(
            /Application error|Internal Server Error|Something went wrong/,
            { exact: false },
          ),
        ).toHaveCount(0);
        await expect(page).not.toHaveURL(/auth\/signin/);
        await expect
          .poll(() =>
            page.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth,
            ),
          )
          .toBe(true);
        // A material heading can render during loading; wait for actual route content.
        if (path === "/") await expect(page.locator('[data-slot="home-account-card"]')).toBeVisible();
        else if (path === "/overview") await expect(page.getByRole("button", { name: "Home equity: view details", exact: true })).toBeVisible();
        else if (path === "/bank") await expect(page.getByRole("textbox", { name: "Search transactions", exact: true })).toBeVisible();
        else if (path === "/mortgage") await expect(page.getByRole("tab", { name: "Overview", exact: true })).toBeVisible();
        else if (path === "/settings") await expect(page.getByRole("switch", { name: "Dark Mode", exact: true })).toBeVisible();
        else if (path === "/budgets/fixture") await expect(page.getByRole("heading", { name: "Spending log", exact: true })).toBeVisible();
        else if (path === "/split/fixture") await expect(page.getByText("Synthetic linked groceries", { exact: true }).first()).toBeVisible();
        else {
          const readyAction: Record<string, string> = { "/cashflow": "Add Expense", "/goals": "New goal", "/split": "New group", "/budgets": "Plan a new budget", "/trips": "Plan a new budget", "/playground": "Run Scenario" };
          await expect(page.getByRole("button", { name: readyAction[path], exact: true }).first()).toBeVisible();
        }
        const header = page.locator('[data-slot="page-header"], [data-slot="cashflow-toolbar"]').filter({ visible: true });
        await expect(header).toHaveCount(1);
        await expect(header).not.toHaveCSS("backdrop-filter", "none");
        const headerGeometry = await header.boundingBox();
        expect(headerGeometry!.x).toBeGreaterThanOrEqual(0);
        expect(headerGeometry!.x + headerGeometry!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
        // Glass is a control layer; financial cards and nested control groups stay solid.
        for (const surface of await page.locator('main .ui-card, main [data-slot="control-group"]').filter({ visible: true }).all()) {
          await expect(surface).toHaveCSS("backdrop-filter", "none");
        }
        const accessibility = await new AxeBuilder({ page }).analyze();
        writeFileSync(
          test.info().outputPath("axe.json"),
          JSON.stringify(accessibility.violations, null, 2),
        );
        await test
          .info()
          .attach("accessibility", {
            body: Buffer.from(
              JSON.stringify(accessibility.violations, null, 2),
            ),
            contentType: "application/json",
          });
        await page.screenshot({ path: test.info().outputPath("route.png") });
        expect(errors).toEqual([]);
        expect(
          accessibility.violations.filter((item) =>
            ["serious", "critical"].includes(item.impact ?? ""),
          ),
        ).toEqual([]);
      });
    }
  });
}

test("the sign-in form remains keyboard reachable", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/auth/signin");
  await page.getByLabel("Email", { exact: true }).focus();
  await expect(page.getByLabel("Email", { exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Password", { exact: true })).toBeFocused();
});
