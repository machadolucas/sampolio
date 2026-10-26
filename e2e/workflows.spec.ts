import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "./fixtures";
import { readFileSync } from "node:fs";

interface Fixture {
  budgetId: string;
  groupId: string;
  linkedTransactionId: string;
  linkedAccountId: string;
  deepTransactionId: string;
}
function fixture(): Fixture {
  return JSON.parse(readFileSync("test-results/synthetic.json", "utf8"));
}
async function expectAccessibleForm(page: Page) {
  const report = await new AxeBuilder({ page }).analyze();
  expect(
    report.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
}
let browserErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /hydrat|uncaught|error boundary/i.test(message.text())
    )
      browserErrors.push(message.text());
  });
});
test.afterEach(async () => {
  expect(browserErrors).toEqual([]);
});

test("bank search and exact split-link details survive table/mobile layouts", async ({
  page,
}) => {
  await page.goto("/bank");
  await expect(
    page.getByRole("heading", { name: "Bank", exact: true }),
  ).toBeVisible();
  const search = page.getByRole("textbox", { name: "Search transactions" });
  await search.fill("Synthetic linked groceries");
  const row = page.locator(
    `.bank-tx-row-${fixture().linkedTransactionId}:visible`,
  );
  await expect(row).toContainText("Synthetic linked groceries");
  if (page.viewportSize()!.width < 1024) {
    const action = page.getByRole("button", {
      name: "Add shared expense",
      exact: true,
    });
    await expect(action).toBeVisible();
    const actionBounds = (await action.boundingBox())!;
    const rowBounds = (await row.boundingBox())!;
    expect(actionBounds.y).toBeLessThan(80);
    expect(actionBounds.y + actionBounds.height).toBeLessThanOrEqual(
      rowBounds.y,
    );
  }
  if (page.viewportSize()!.width >= 1024)
    await row.getByRole("button", { name: "Expand row" }).click();
  else
    await row
      .getByRole("button", {
        name: /^Show details for Synthetic linked groceries,/,
      })
      .click();
  await expect(
    page.getByText("Booking date", { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await search.fill("Synthetic purchase 124");
  await expect(
    page
      .getByText("Synthetic purchase 124", { exact: true })
      .filter({ visible: true }),
  ).toBeVisible();
  await expect(page.getByText(/1 of 125 transactions match/)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("bank-search.png") });
});

test("desktop bank viewport reveals more than its first50 transactions", async ({
  page,
}) => {
  test.skip(
    page.viewportSize()!.width < 1024,
    "Mobile uses month groups instead of the desktop reveal viewport",
  );
  await page.goto("/bank");
  await expect(page.getByText(/Showing 50 of 125/)).toBeVisible();
  const viewport = page.locator('[data-slot="table-scroll"]:visible');
  await viewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(page.getByText(/Showing 100 of 125/)).toBeVisible();
  await page.getByRole("button", { name: "Choose optional columns" }).click();
  await expect(
    page.getByRole("checkbox", { name: "Counterparty / details", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Status", exact: true }).uncheck();
  await expect(
    page.getByRole("columnheader", { name: "Status", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Reset columns", exact: true })
    .click();
  await expect(
    page.getByRole("columnheader", { name: "Status", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
});

test("budget money commits on first submit and deletion awaits global confirmation", async ({
  page,
}) => {
  const title = `Synthetic browser purchase ${test.info().project.name}`;
  await page.goto(`/budgets/${fixture().budgetId}`);
  await expect(
    page.getByRole("heading", { name: "Spending log", exact: true }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "What was it?" }).fill(title);
  await page.getByLabel("Amount", { exact: true }).fill("12,34");
  const date = page.getByRole("textbox", { name: "Date", exact: true });
  const readable = await date.evaluate((element) => {
    const input = element as HTMLInputElement;
    const style = getComputedStyle(input);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d")!;
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    return (
      input.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight) >=
      context.measureText(input.value).width
    );
  });
  expect(readable).toBe(true);
  await page.screenshot({
    path: test.info().outputPath("budget-quick-entry.png"),
  });
  await expectAccessibleForm(page);
  // Click directly from the focused money field: no separate blur beforehand.
  await page
    .locator("form")
    .filter({ has: page.getByRole("textbox", { name: "What was it?" }) })
    .getByRole("button", { name: "Add", exact: true })
    .click();
  await expect(
    page.getByText(title, { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await expect(
    page.getByText("12,34", { exact: false }).filter({ visible: true }).first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: `Delete ${title}`, exact: true })
    .click();
  const confirmation = page.getByRole("alertdialog", {
    name: "Delete expense",
  });
  await expect(confirmation).toBeVisible();
  await confirmation
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(confirmation).toBeHidden();
  await expect(page.getByText(title, { exact: true })).toHaveCount(0);
});

for (const theme of ["light", "dark"] as const) {
  test.describe(`mortgage ${theme}`, () => {
    test.use({ colorScheme: theme });
    test("mortgage grouped menu retains extra-payment action and local month input", async ({
      page,
    }) => {
      await page.goto("/mortgage");
      await expect(
        page.getByText("Synthetic home", { exact: true }).first(),
      ).toBeVisible();
      await page.getByRole("button", { name: "Manage" }).click();
      await page
        .getByRole("menuitem", { name: "Make an extra payment" })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "Make an extra payment",
      });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel("Month", { exact: true })).toHaveAttribute(
        "type",
        "month",
      );
      await dialog.getByLabel("Amount", { exact: true }).fill("20,50");
      await expectAccessibleForm(page);
      await dialog
        .getByRole("button", { name: "Add payment", exact: true })
        .click();
      await expect(dialog).toBeHidden();
      await expect(
        page.getByText("Extra payment added.", { exact: true }),
      ).toBeVisible();
      await page.getByRole("tab", { name: "Schedule", exact: true }).click();
      await expect(
        page.getByRole("switch", {
          name: "Loan-by-loan breakdown",
          exact: true,
        }),
      ).toBeVisible();
      await expectAccessibleForm(page);
      const viewport = page.locator(
        '.mortgage-ledger [data-slot="table-scroll"]',
      );
      const current = viewport.locator("tr.ledger-current");
      await expect(current).toBeInViewport();
      await viewport.evaluate((element) => {
        element.scrollLeft = 400;
      });
      const month = current.locator("td").first();
      await expect
        .poll(async () =>
          Math.abs(
            (await month.boundingBox())!.x - (await viewport.boundingBox())!.x,
          ),
        )
        .toBeLessThan(3);
      await page
        .getByRole("button", { name: "Choose optional columns" })
        .click();
      await expect(
        page.getByRole("checkbox", { name: "Month", exact: true }),
      ).toHaveCount(0);
      await page.getByRole("checkbox", { name: "Rate", exact: true }).uncheck();
      await expect(
        page.getByRole("columnheader", { name: /^Rate/ }),
      ).toHaveCount(0);
      await page
        .getByRole("button", { name: "Reset columns", exact: true })
        .click();
      await page.keyboard.press("Escape");
      await page.screenshot({
        path: test.info().outputPath("mortgage-populated.png"),
      });
    });
  });
}

test("split expense saves an immediately typed comma-decimal amount", async ({
  page,
}) => {
  const title = `Synthetic shared lunch ${test.info().project.name}`;
  await page.goto(`/split/${fixture().groupId}`);
  await expect(
    page.getByRole("heading", { name: "Synthetic household", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add expense", exact: true });
  await dialog.getByPlaceholder("Description").fill(title);
  await dialog
    .getByRole("button", { name: "Choose date", exact: true })
    .click();
  const calendar = page.locator(".ui-calendar:visible");
  await expect(calendar).toBeVisible();
  const bounds = await calendar.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  await expectAccessibleForm(page);
  const selected = calendar.locator('button[tabindex="0"]').last();
  const before = await dialog
    .getByRole("textbox", { name: "Date", exact: true })
    .inputValue();
  await selected.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(calendar).toBeHidden();
  const expected = await page.evaluate((text) => {
    const [day, month, year] = text.split(".").map(Number);
    const date = new Date(year, month - 1, day + 1);
    return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.${date.getFullYear()}`;
  }, before);
  await expect(
    dialog.getByRole("textbox", { name: "Date", exact: true }),
  ).toHaveValue(expected);
  await dialog.getByPlaceholder("0,00").fill("17,50");
  await expectAccessibleForm(page);
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByText(title, { exact: true }).filter({ visible: true }),
  ).toBeVisible();
});

test("bank deep link reveals an offscreen older transaction and keeps details expanded", async ({
  page,
}) => {
  const data = fixture();
  await page.goto(
    `/bank?account=${data.linkedAccountId}&tx=${data.deepTransactionId}`,
  );
  const row = page.locator(`.bank-tx-row-${data.deepTransactionId}:visible`);
  await expect(row).toBeInViewport();
  await expect(
    page.getByText("Booking date", { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await expect(page).not.toHaveURL(/[?&]tx=/);
});

test("quick shared expense commits the first comma-decimal entry", async ({
  page,
}) => {
  const title = `Synthetic quick lunch ${test.info().project.name}`;
  await page.goto("/");
  const quickAdd = page.getByRole("button", {
    name: "Add shared expense",
    exact: true,
  });
  if (page.viewportSize()!.width < 1024) {
    await expect(quickAdd).toBeVisible();
    expect((await quickAdd.boundingBox())!.y).toBeLessThan(80);
  }
  await quickAdd.click();
  const dialog = page.getByRole("dialog", { name: "Add expense", exact: true });
  await dialog.getByPlaceholder("What was it for?").fill(title);
  await dialog.getByPlaceholder("0,00").fill("13,75");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.goto(`/split/${fixture().groupId}`);
  await expect(
    page.locator("[data-expense-id]").getByText(title, { exact: true }),
  ).toBeVisible();
});
