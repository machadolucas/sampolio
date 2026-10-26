import { readFileSync } from "node:fs";
import sharp from "sharp";
import { addMonths, endOfMonth, format, parse } from "date-fns";
import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "./fixtures";

const currency =
  /€[ \u00a0]*[−-]?\d[\d \u00a0.,]*|[−-]?\d[\d \u00a0.,]*[ \u00a0]*€/g;
function fixture(): {
  budgetId: string;
  groupId: string;
  linkedTransactionId: string;
} {
  return JSON.parse(readFileSync("test-results/synthetic.json", "utf8"));
}
async function command(page: Page) {
  await page
    .getByRole("button", { name: /^Search(?: ⌘K)?$/ })
    .filter({ visible: true })
    .click();
  const palette = page.getByRole("dialog", {
    name: "Command palette",
    exact: true,
  });
  await palette.getByRole("combobox").fill("demo");
  await palette.getByRole("option", { name: /Toggle demo mode/ }).click();
  await expect(palette).toBeHidden();
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
async function tokenColor(page: Page, variable: string) {
  return page.evaluate((variable) => {
    const probe = document.createElement("div");
    probe.style.backgroundColor = `var(${variable})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  }, variable);
}
async function accessible(page: Page) {
  const report = await new AxeBuilder({ page }).analyze();
  expect(
    report.violations.filter((item) =>
      ["serious", "critical"].includes(item.impact ?? ""),
    ),
  ).toEqual([]);
}
async function pixelDifference(first: Buffer, second: Buffer) {
  const a = await sharp(first).removeAlpha().raw().toBuffer();
  const b = await sharp(second).removeAlpha().raw().toBuffer();
  expect(a.length).toBe(b.length);
  let sum = 0;
  for (let index = 0; index < a.length; index++)
    sum += Math.abs(a[index] - b[index]);
  return sum / a.length;
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`material ${theme}`, () => {
    test.use({ colorScheme: theme });
    test.beforeEach(async ({ page }, info) => {
      const media = await page.evaluate(() => ({
        standard: CSS.supports("backdrop-filter", "blur(1px)"),
        webkit: CSS.supports("-webkit-backdrop-filter", "blur(1px)"),
        reducedTransparency: matchMedia(
          "(prefers-reduced-transparency: reduce)",
        ).matches,
        increasedContrast: matchMedia("(prefers-contrast: more)").matches,
      }));
      await info.attach("native-material-capabilities", {
        body: JSON.stringify(media),
        contentType: "application/json",
      });
    });

    test("Home surfaces follow the theme and the real modal header composites blur independently of its opaque body", async ({
      page,
    }) => {
      await page.goto("/");
      const home = page.locator('[data-slot="home-dashboard"]');
      const account = home.locator('[data-slot="home-account-card"]');
      const projected = home.locator('[data-slot="home-projected-card"]');
      await expect(account).toBeVisible();
      await expect(account).toHaveCSS(
        "background-color",
        await tokenColor(page, "--card"),
      );
      await expect(projected).toHaveCSS(
        "background-color",
        await tokenColor(page, "--accent"),
      );
      await expect(account).toHaveCSS(
        "border-top-color",
        await tokenColor(page, "--border"),
      );
      await page.screenshot({
        path: test.info().outputPath("home-material.png"),
      });
      await projected.click();
      const modal = page.locator(".ui-dialog:visible");
      const header = modal.locator(".ui-dialog-header");
      const body = modal.locator(".ui-dialog-content");
      await expect(header).toBeVisible();
      await expect(modal).toHaveCSS("backdrop-filter", "none");
      await expect(modal).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await test.info().attach("header-computed-material", {
        body: JSON.stringify(
          await header.evaluate((element) => ({
            standard:
              getComputedStyle(element).getPropertyValue("backdrop-filter"),
            webkit: getComputedStyle(element).getPropertyValue(
              "-webkit-backdrop-filter",
            ),
            reduceAttribute: document.documentElement.hasAttribute(
              "data-reduce-transparency",
            ),
            blurToken:
              getComputedStyle(element).getPropertyValue("--glass-blur"),
          })),
        ),
        contentType: "application/json",
      });
      await expect(header).not.toHaveCSS("backdrop-filter", "none");
      await expect(body).toHaveCSS("backdrop-filter", "none");
      await expect(body).toHaveCSS(
        "background-color",
        await tokenColor(page, "--card"),
      );
      const headerBox = (await header.boundingBox())!;
      const bodyBox = (await body.boundingBox())!;
      expect(bodyBox.y).toBeGreaterThanOrEqual(
        headerBox.y + headerBox.height - 1,
      );
      await page.evaluate(() => {
        const stripes = document.createElement("div");
        stripes.id = "synthetic-material-stripes";
        stripes.style.cssText =
          "position:fixed;inset:0;z-index:80;pointer-events:none;background:repeating-linear-gradient(90deg,#111 0px,#111 4px,#eee 4px,#eee 8px)";
        document.body.append(stripes);
      });
      const blurred = await header.screenshot({
        path: test.info().outputPath("modal-header-blurred.png"),
      });
      const opaqueBefore = await body.screenshot();
      await header.evaluate((element) => {
        (element as HTMLElement).style.backdropFilter = "none";
        (element as HTMLElement).style.setProperty(
          "-webkit-backdrop-filter",
          "none",
        );
      });
      const unblurred = await header.screenshot({
        path: test.info().outputPath("modal-header-unblurred.png"),
      });
      const opaqueAfter = await body.screenshot();
      const headerDifference = await pixelDifference(blurred, unblurred);
      const bodyDifference = await pixelDifference(opaqueBefore, opaqueAfter);
      expect(headerDifference).toBeGreaterThan(0.25);
      expect(bodyDifference).toBeLessThan(0.1);
      await test.info().attach("material-pixel-evidence", {
        body: JSON.stringify({ headerDifference, bodyDifference }),
        contentType: "application/json",
      });
      await header.evaluate((element) => {
        (element as HTMLElement).style.removeProperty("backdrop-filter");
        (element as HTMLElement).style.removeProperty(
          "-webkit-backdrop-filter",
        );
      });
      await page.evaluate(() =>
        document.getElementById("synthetic-material-stripes")?.remove(),
      );
      await noOverflow(page);
    });

    test("the open calendar has bounded 44px navigation with visible chevrons and working month changes", async ({
      page,
    }) => {
      await page.goto(`/budgets/${fixture().budgetId}`);
      const trigger = page.getByRole("button", {
        name: "Choose date",
        exact: true,
      });
      await trigger.evaluate((element) =>
        element.scrollIntoView({ block: "end" }),
      );
      const dateInput = page.getByRole("textbox", {
        name: "Date",
        exact: true,
      });
      const originalDate = await dateInput.inputValue();
      await trigger.click();
      const calendar = page.locator(".ui-calendar:visible");
      const popup = page
        .locator(".ui-select-popup:visible")
        .filter({ has: calendar });
      async function assertCalendarBounds() {
        await expect
          .poll(async () => {
            const box = await calendar.boundingBox();
            const viewport = page.viewportSize()!;
            return (
              !!box &&
              box.x >= 0 &&
              box.y >= 0 &&
              box.x + box.width <= viewport.width + 1 &&
              box.y + box.height <= viewport.height + 1
            );
          })
          .toBe(true);
        await test.info().attach("calendar-viewport-geometry", {
          body: JSON.stringify({
            calendar: await calendar.boundingBox(),
            popup: await popup.boundingBox(),
            viewport: page.viewportSize(),
          }),
          contentType: "application/json",
        });
      }
      await assertCalendarBounds();
      const previous = calendar.locator("button.rdp-button_previous");
      const next = calendar.locator("button.rdp-button_next");
      const caption = calendar.locator(".rdp-month_caption");
      const before = await caption.innerText();
      const calendarBox = (await calendar.boundingBox())!;
      expect(calendarBox.x).toBeGreaterThanOrEqual(0);
      expect(calendarBox.x + calendarBox.width).toBeLessThanOrEqual(
        page.viewportSize()!.width,
      );
      for (const navigation of [previous, next]) {
        const box = (await navigation.boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.width).toBeLessThanOrEqual(52);
        expect(box.height).toBeLessThanOrEqual(52);
        const icon = navigation.locator("svg");
        await expect(icon).toBeVisible();
        const iconBox = (await icon.boundingBox())!;
        expect(iconBox.width).toBeGreaterThan(10);
        expect(
          Math.abs(iconBox.x + iconBox.width / 2 - box.x - box.width / 2),
        ).toBeLessThan(2);
        expect(
          Math.abs(iconBox.y + iconBox.height / 2 - box.y - box.height / 2),
        ).toBeLessThan(2);
      }
      await next.click();
      await expect(caption).not.toHaveText(before);
      await assertCalendarBounds();
      const lastDay = calendar.locator("button.rdp-day_button").last();
      await expect(lastDay).toBeInViewport({ ratio: 1 });
      const lastDate = format(
        endOfMonth(addMonths(parse(originalDate, "dd.MM.yyyy", new Date()), 1)),
        "dd.MM.yyyy",
      );
      await lastDay.click();
      await expect(calendar).toBeHidden();
      await expect(dateInput).toHaveValue(lastDate);
      await trigger.click();
      await previous.click();
      await expect(caption).toHaveText(before);
      await assertCalendarBounds();
      await accessible(page);
      await page.screenshot({
        path: test.info().outputPath("calendar-open.png"),
      });
      await calendar.getByRole("button").filter({ hasText: /^15$/ }).click();
      await expect(dateInput).toHaveValue(
        `15.${originalDate.split(".").slice(1).join(".")}`,
      );
      await expect(calendar).toBeHidden();
      await noOverflow(page);
    });

    test("collapsed desktop navigation centers brand, search, route and footer icons", async ({
      page,
    }) => {
      test.skip(page.viewportSize()!.width < 1024, "Desktop sidebar only");
      await page.goto("/");
      const aside = page.getByRole("complementary", {
        name: "Main navigation",
      });
      await aside
        .getByRole("button", { name: "Collapse sidebar", exact: true })
        .click();
      await expect(aside).toHaveCSS("width", "72px");
      const asideBox = (await aside.boundingBox())!;
      for (const control of [
        aside.getByRole("link", { name: "Sampolio home", exact: true }),
        aside.getByRole("button", { name: "Search", exact: true }),
        aside.getByRole("link", { name: "Home", exact: true }),
        aside.getByRole("button", { name: "Expand sidebar", exact: true }),
        aside.getByRole("button", { name: /Alex account menu/ }),
      ]) {
        const box = (await control.boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(
          Math.abs(box.x + box.width / 2 - asideBox.x - asideBox.width / 2),
        ).toBeLessThan(2);
        const content = control
          .locator('svg,[aria-hidden="true"] > div')
          .first();
        const icon = (await content.boundingBox())!;
        expect(
          Math.abs(icon.x + icon.width / 2 - asideBox.x - asideBox.width / 2),
        ).toBeLessThan(2);
      }
      await page.screenshot({
        path: test.info().outputPath("sidebar-collapsed.png"),
      });
    });

    test("Cashflow keeps a floating sticky material toolbar, selected month and opaque reduced-transparency fallback", async ({
      page,
    }) => {
      await page.goto("/cashflow");
      const wrapper = page.locator('[data-slot="cashflow-sticky"]');
      const toolbar = page.getByRole("region", {
        name: "Cashflow controls",
        exact: true,
      });
      await expect(toolbar).toBeVisible();
      await expect(wrapper).toHaveCSS("position", "sticky");
      await expect(toolbar).not.toHaveCSS("backdrop-filter", "none");
      const selected = toolbar.locator(
        '[data-month][aria-current="true"]:visible',
      );
      const month = await selected.getAttribute("data-month");
      const expandedHeight = (await toolbar.boundingBox())!.height;
      const strip = toolbar.locator(
        '[data-slot="cashflow-month-strip"]:visible',
      );
      const months = await strip
        .locator("[data-month]")
        .evaluateAll((elements) =>
          elements.map((element) => (element as HTMLElement).dataset.month!),
        );
      const neighbor =
        months[Math.min(months.indexOf(month!) + 1, months.length - 1)];
      expect(neighbor).not.toBe(month);
      await strip.locator(`[data-month="${neighbor}"]`).click();
      await expect(strip.locator(`[data-month="${neighbor}"]`)).toHaveAttribute(
        "aria-current",
        "true",
      );
      await page.evaluate(() => window.scrollTo(0, 700));
      if (page.viewportSize()!.width < 1024) {
        await expect(wrapper).toHaveAttribute("data-collapsed", "true");
        expect((await toolbar.boundingBox())!.height).toBeLessThan(
          expandedHeight,
        );
        expect((await toolbar.boundingBox())!.y).toBeGreaterThanOrEqual(64);
      }
      await expect(
        toolbar.locator(`[data-month="${neighbor}"]:visible`),
      ).toHaveAttribute("aria-current", "true");
      for (const button of await toolbar.locator("button:visible").all()) {
        const box = (await button.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      await noOverflow(page);
      await page.screenshot({
        path: test.info().outputPath("cashflow-toolbar.png"),
      });
      await page.evaluate(() => {
        localStorage.setItem("sampolio-reduce-transparency", "true");
        window.dispatchEvent(
          new StorageEvent("storage", { key: "sampolio-reduce-transparency" }),
        );
      });
      await expect(toolbar).toHaveCSS("backdrop-filter", "none");
      await expect(toolbar).toHaveCSS(
        "background-color",
        await tokenColor(page, "--card"),
      );
      await page.screenshot({
        path: test.info().outputPath("cashflow-opaque.png"),
      });
      await page.evaluate(() => {
        localStorage.removeItem("sampolio-reduce-transparency");
        window.dispatchEvent(
          new StorageEvent("storage", { key: "sampolio-reduce-transparency" }),
        );
        window.scrollTo(0, 0);
      });
      await expect(wrapper).toHaveAttribute("data-collapsed", "false");
    });

    test("Demo masks every sampled amount immediately in Home and data views without navigation or resetting expanded bank details", async ({
      page,
    }) => {
      test.setTimeout(120_000);
      const data = fixture();
      for (const path of [
        "/",
        "/goals",
        `/budgets/${data.budgetId}`,
        `/split/${data.groupId}`,
        "/bank",
        "/overview",
      ]) {
        await page.goto(path);
        const main = page.getByRole("main");
        await expect
          .poll(
            async () => ((await main.innerText()).match(currency) ?? []).length,
          )
          .toBeGreaterThan(0);
        if (path === "/overview")
          await expect(
            main.getByRole("button", {
              name: "Home equity: view details",
              exact: true,
            }),
          ).toBeVisible();
        const original = [
          ...new Set((await main.innerText()).match(currency) ?? []),
        ].slice(0, 5);
        if (path === "/bank") {
          await page
            .getByRole("textbox", { name: "Search transactions" })
            .fill("Synthetic linked groceries");
          const row = page.locator(
            `.bank-tx-row-${data.linkedTransactionId}:visible`,
          );
          if (page.viewportSize()!.width >= 1024)
            await row
              .getByRole("button", { name: "Expand row", exact: true })
              .click();
          else
            await row
              .getByRole("button", {
                name: /^Show details for Synthetic linked groceries,/,
              })
              .click();
          await expect(
            page
              .getByText("Booking date", { exact: true })
              .filter({ visible: true }),
          ).toBeVisible();
        }
        const url = page.url();
        await command(page);
        await expect
          .poll(async () => (await main.innerText()).match(currency) ?? [])
          .toEqual([]);
        await expect(main).toContainText("✱✱✱");
        await expect(page).toHaveURL(url);
        if (path === "/bank") {
          await expect(
            page.getByRole("textbox", { name: "Search transactions" }),
          ).toHaveValue("Synthetic linked groceries");
          await expect(
            page
              .getByText("Booking date", { exact: true })
              .filter({ visible: true }),
          ).toBeVisible();
        }
        if (path === "/overview") {
          const descriptions = main.locator('[id^="chart-desc-"]');
          await expect
            .poll(async () => (await descriptions.allTextContents()).length)
            .toBeGreaterThan(0);
          expect((await descriptions.allTextContents()).join(" ")).not.toMatch(
            currency,
          );
        }
        if (path === "/" && page.viewportSize()!.width >= 1024) {
          await page
            .getByRole("complementary", { name: "Main navigation" })
            .getByRole("button", { name: /Alex account menu/ })
            .click();
          await page
            .getByRole("menuitem", { name: "Exit demo mode", exact: true })
            .click();
        } else await command(page);
        await expect
          .poll(async () => await main.innerText())
          .not.toContain("✱✱✱");
        const restored = await main.innerText();
        for (const sample of original)
          if (path !== "/bank") expect(restored).toContain(sample);
        await expect(page).toHaveURL(url);
      }
    });

    test("a typed Cashflow draft survives immediate Demo on/off without remounting the form", async ({
      page,
    }) => {
      await page.goto("/cashflow");
      await page
        .getByRole("button", { name: "Add Expense", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "Add Item",
        exact: true,
      });
      await dialog
        .getByRole("textbox", { name: "Name", exact: true })
        .fill("Synthetic material draft");
      const amount = dialog.getByLabel("Amount (EUR)", { exact: true });
      await amount.fill("12,34");
      const control = await page.context().newPage();
      try {
        await control.goto("/");
        await command(control);
        await expect(dialog).toBeVisible();
        await expect(
          dialog.getByRole("textbox", { name: "Name", exact: true }),
        ).toHaveValue("Synthetic material draft");
        await expect(amount).toHaveValue(/12,34/);
        await command(control);
        await expect(dialog).toBeVisible();
        await expect(amount).toHaveValue(/12,34/);
      } finally {
        await control.close();
      }
    });
  });
}
