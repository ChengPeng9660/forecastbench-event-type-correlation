import { defineConfig, devices } from "@playwright/test";

const ciBrowser = process.env.CI ? { channel: "chrome" as const } : {};

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run build && npm run preview -- --host 127.0.0.1",
    port: 4173,
    reuseExistingServer: true,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], ...ciBrowser } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], browserName: "chromium", isMobile: false, ...ciBrowser },
    },
  ],
});
