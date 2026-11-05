import { defineConfig } from "@playwright/test";

import { smokeEnv } from "./stack";

const env = smokeEnv();

// Edge comes with Windows, so the smoke test needs no browser download
// there. Elsewhere it uses Playwright's Chromium, or SMOKE_CHROMIUM_PATH.
const channel =
  process.env.SMOKE_BROWSER_CHANNEL ??
  (process.platform === "win32" ? "msedge" : undefined);

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  timeout: 10 * 60_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "../playwright-report" }],
  ],
  outputDir: "../test-results",
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  use: {
    baseURL: `http://localhost:${env.APP_PORT}`,
    channel,
    launchOptions: {
      executablePath: process.env.SMOKE_CHROMIUM_PATH || undefined,
    },
    // Setup saves the browser's time zone and ticks it as one to work in,
    // so the run doesn't depend on the computer's.
    timezoneId: "Europe/Belgrade",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
