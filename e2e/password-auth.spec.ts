import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";

test("Sam signs in with the real password form by pressing Enter", async ({
  page,
  context,
}) => {
  await context.clearCookies();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/auth/signin");
  await page.getByLabel("Email", { exact: true }).fill("sam@example.com");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Synthetic-Only-2026!");
  await page.keyboard.press("Enter");
  await expect(page).not.toHaveURL(/auth\/signin/);
  await expect(page.getByRole("main")).toBeVisible();
  const response = await context.request.get("/api/auth/get-session");
  expect(response.ok()).toBeTruthy();
  expect((await response.json()).user.email).toBe("sam@example.com");
  expect(errors).toEqual([]);
});

test.describe("dark public authentication states", () => {
  test.use({ colorScheme: "dark" });
  test("signup validates a weak synthetic password without submitting an account", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto("/auth/signup");
    await page.getByLabel("Name", { exact: true }).fill("Alex");
    await page
      .getByLabel("Email", { exact: true })
      .fill("alex.signup@example.com");
    await page.getByLabel("Password", { exact: true }).fill("short");
    await page.getByLabel("Confirm Password", { exact: true }).fill("short");
    await page
      .getByRole("button", { name: "Create Account", exact: true })
      .click();
    await expect(
      page.getByText("Password must be at least 8 characters", { exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(/auth\/signup/);
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    const report = await new AxeBuilder({ page }).analyze();
    expect(
      report.violations.filter((item) =>
        ["serious", "critical"].includes(item.impact ?? ""),
      ),
    ).toEqual([]);
    await page.screenshot({
      path: test.info().outputPath("signup-validation.png"),
    });
  });
  test("auth errors show fixed messages and a working return link", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto("/auth/error?error=Synthetic-untrusted-error");
    await expect(
      page.getByRole("heading", { name: "Sign-in problem", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Synthetic-untrusted-error", { exact: true }),
    ).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    const report = await new AxeBuilder({ page }).analyze();
    expect(
      report.violations.filter((item) =>
        ["serious", "critical"].includes(item.impact ?? ""),
      ),
    ).toEqual([]);
    await page
      .getByRole("link", { name: "Back to sign in", exact: true })
      .click();
    await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  });
});
