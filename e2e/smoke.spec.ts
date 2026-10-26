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
