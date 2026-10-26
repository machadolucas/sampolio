import { test, expect } from "./fixtures";

test.use({ reducedMotion: "no-preference" });
test("normal motion retains menu and dialog focus behavior", async ({
  page,
}) => {
  await page.goto("/mortgage");
  expect(
    await page.evaluate(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    ),
  ).toBe(false);
  const manage = page.getByRole("button", {
    name: "Manage mortgage",
    exact: true,
  });
  await manage.click();
  await page.getByRole("menuitem", { name: "Make an extra payment" }).click();
  const dialog = page.getByRole("dialog", { name: "Make an extra payment" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Amount", { exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(manage).toBeFocused();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
});
