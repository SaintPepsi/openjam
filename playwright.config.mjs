import { defineConfig } from "@playwright/test";

// One worker: every spec shares one extension-loaded browser, and recordings
// are global session state in the background worker.
export default defineConfig({
  testDir: "e2e",
  workers: 1,
  timeout: 60_000,
  reporter: [["list"]],
  // Visual baselines are Linux-rendered (generated + compared in the pinned
  // Playwright Docker image, which CI also runs in). macOS renders text
  // differently, so skip snapshot comparison locally — CI is the source of
  // truth. Regenerate with: npm run test:snapshots.
  ignoreSnapshots: !process.env.CI,
  expect: {
    // Absorb sub-pixel antialiasing noise without masking real UI changes.
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled" },
  },
});
