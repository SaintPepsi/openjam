import { defineConfig } from "@playwright/test";

// One worker: every spec shares one extension-loaded browser, and recordings
// are global session state in the background worker.
export default defineConfig({
  testDir: "e2e",
  workers: 1,
  timeout: 60_000,
  reporter: [["list"]],
});
