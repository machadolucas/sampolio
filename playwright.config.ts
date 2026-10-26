import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  outputDir: "test-results/browser",
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  use: {
    baseURL: "http://localhost:4999",
    browserName: "chromium",
    channel: "chrome",
    launchOptions: { args: ["--disable-webgl", "--disable-gpu"] },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    reducedMotion: "reduce",
  },
  webServer: {
    command: `node scripts/browser-fixture.mjs ${process.env.SAMPOLIO_BROWSER_MODE === "serve" ? "serve" : "dev"}`,
    url: "http://localhost:4999/auth/signin",
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 180_000,
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "desktop",
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
        storageState: "test-results/.auth/alex.json",
      },
      testIgnore: /auth\.setup\.ts/,
    },
    {
      name: "tablet",
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 768, height: 1024 },
        storageState: "test-results/.auth/alex.json",
      },
      testIgnore: /auth\.setup\.ts/,
    },
    {
      name: "mobile",
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        storageState: "test-results/.auth/alex.json",
      },
      testIgnore: /auth\.setup\.ts/,
    },
  ],
});
