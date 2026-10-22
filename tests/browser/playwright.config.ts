import { defineConfig } from "@playwright/test";

export const HARNESS_PORT = 5180;

export default defineConfig({
  testDir: ".",
  outputDir: "test-results",
  // Specs share the archives and the GPU: one at a time.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 120_000,
  reporter: [["list"]],
  expect: {
    // SwiftShader captures are slow: room for the stability retries.
    timeout: 15_000,
    // The baselines are the historical renderer's own pixels, which the
    // renderer reproduces exactly on SwiftShader: no tolerance. A 1 % change
    // of the trail fade already differs on 5 % of the stage.
    toHaveScreenshot: { threshold: 0, maxDiffPixels: 0 },
  },
  use: {
    // Playwright's Chromium has no H.264: GeoVideo needs Google Chrome.
    channel: "chrome",
    viewport: { width: 800, height: 600 },
    deviceScaleFactor: 1,
    launchOptions: {
      // Headless WebGL2 on SwiftShader: no GPU or driver in the images.
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    },
  },
  webServer: {
    command: `npx vite --config tests/browser/vite.config.ts --port ${HARNESS_PORT} --strictPort`,
    cwd: "../..",
    url: `http://localhost:${HARNESS_PORT}/`,
    // A running server may serve another entry under test.
    reuseExistingServer: false,
  },
});
