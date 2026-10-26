import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures";

test("admin users retain sorting, 5/10/25 pagination, passkey information and guarded actions", async ({
  page,
}) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: /^Advanced / }).click();
  await page.getByRole("tab", { name: "Admin", exact: true }).click();
  await page.getByRole("button", { name: "Users", exact: true }).click();
  const users = page.getByRole("dialog", {
    name: "User Management",
    exact: true,
  });
  const rows = users.locator("tbody tr");
  await expect(rows).toHaveCount(10);
  await users
    .getByRole("combobox", { name: "Rows per page" })
    .selectOption("5");
  await expect(rows).toHaveCount(5);
  await expect(users.getByText("Page 1 of 3", { exact: true })).toBeVisible();
  await users.getByRole("button", { name: "Next", exact: true }).click();
  await expect(users.getByText("Page 2 of 3", { exact: true })).toBeVisible();
  await users.getByRole("button", { name: "Last", exact: true }).click();
  await expect(users.getByText("Page 3 of 3", { exact: true })).toBeVisible();
  await expect(rows).toHaveCount(2);
  await users
    .getByRole("combobox", { name: "Go to page", exact: true })
    .selectOption("0");
  await expect(users.getByText("Page 1 of 3", { exact: true })).toBeVisible();
  await users.getByRole("button", { name: "Next", exact: true }).click();
  await users.getByRole("button", { name: "First", exact: true }).click();
  await expect(
    users.getByRole("button", { name: "First", exact: true }),
  ).toBeDisabled();
  await users
    .getByRole("combobox", { name: "Rows per page" })
    .selectOption("25");
  await expect(rows).toHaveCount(12);
  const name = users.getByRole("columnheader", { name: "Name", exact: true });
  await name.getByRole("button", { name: "Name", exact: true }).click();
  await expect(name).toHaveAttribute("aria-sort", "ascending");
  await expect(rows.first().locator("td").nth(1)).toHaveText("Alex");
  await name.getByRole("button", { name: "Name", exact: true }).click();
  await expect(name).toHaveAttribute("aria-sort", "descending");
  await expect(rows.first().locator("td").nth(1)).toHaveText("Sam 10");
  await expect(
    users.getByRole("columnheader", { name: "Passkeys", exact: true }),
  ).toBeVisible();
  await expect(
    users.getByRole("button", { name: "Delete Alex", exact: true }),
  ).toBeDisabled();
  await users.getByRole("button", { name: "Edit Sam 10", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Edit User", exact: true });
  await expect(edit.getByText("Passkeys: 0", { exact: true })).toBeVisible();
  await expect(
    edit.getByRole("button", { name: "Remove passkeys", exact: true }),
  ).toBeDisabled();
  const report = await new AxeBuilder({ page }).analyze();
  expect(
    report.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
  await edit.getByRole("button", { name: "Cancel", exact: true }).click();
  await users
    .getByRole("button", { name: "Delete Sam 10", exact: true })
    .click();
  const confirmation = page.getByRole("alertdialog", {
    name: "Confirm Delete",
    exact: true,
  });
  await expect(confirmation).toContainText("Sam 10");
  await confirmation.getByRole("button", { name: "No", exact: true }).click();
  await expect(rows).toHaveCount(12);
  await users
    .getByRole("combobox", { name: "Rows per page" })
    .selectOption("10");
  await expect(rows).toHaveCount(10);
  await page.screenshot({ path: test.info().outputPath("users-table.png") });
});
