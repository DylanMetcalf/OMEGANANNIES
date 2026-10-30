import { defineConfig, devices } from "@playwright/test";
const exe = process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";
export default defineConfig({
  testDir: "tests/e2e", globalSetup: "./tests/e2e/global-setup.ts", timeout: 60_000, fullyParallel: false, workers: 1, reporter: [["list"]],
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", launchOptions: { executablePath: exe }, trace: "retain-on-failure" },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"], launchOptions: { executablePath: exe } }, grepInvert: /@mobile(?! accessibility)/ }, { name: "mobile", use: { ...devices["Pixel 7"], launchOptions: { executablePath: exe } }, grep: /@mobile/ }],
});
