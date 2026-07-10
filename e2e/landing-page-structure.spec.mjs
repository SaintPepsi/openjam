// Structural + visual regression tests for the marketing landing page
// (docs/index.html). The DOM-structure test runs everywhere and gives
// "confidence about structure" even on macOS, where playwright.config's
// `ignoreSnapshots` skips pixel comparison. The visual test is a full-page
// pixel baseline (Linux-rendered via `npm run test:snapshots`, compared in CI).
import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Read once; the page is self-contained (no external requests except the
// easter-egg mp3, which 404s here harmlessly — its waveform region is masked).
const INDEX = readFileSync(path.join(ROOT, "docs", "index.html"));

let server;
let url;
test.beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(INDEX);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${server.address().port}/`;
});
test.afterAll(async () => {
  await new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  });
});

// Reduced motion quiets the page's motion-safe animations; the viewport pins a
// deterministic layout width for the full-page shot.
test.use({ reducedMotion: "reduce", viewport: { width: 1280, height: 900 } });

// Disconfirming input: rename or remove a section heading — the matching
// toContainText fails (verified: "Three steps" → "DISCONFIRM" failed on #how h2).
test("landing page structure: the six sections and their headings render", async ({ page }) => {
  await page.goto(url, { waitUntil: "load" });
  await expect(page.locator("section.hero h1")).toContainText("that stay");
  await expect(page.locator("#shift h2")).toContainText("repro you can hear");
  await expect(page.locator("#privacy h2")).toContainText("never");
  await expect(page.locator("#compare h2")).toContainText("version you control");
  await expect(page.locator("#how h2")).toContainText("Three steps");
  await expect(page.locator("#get h2")).toContainText("Keep the file");
  // The shared <openjam-popup> component is embedded in the hero.
  await expect(page.locator("section.hero openjam-popup")).toBeVisible();
});

// Disconfirming input: any structural/layout change to the page — the full-page
// pixel diff exceeds maxDiffPixelRatio (verified: hiding #compare changed 18% of
// pixels and the page height, well past the 0.01 threshold).
test("landing page visual structure (full-page pixel baseline)", async ({ page }) => {
  await page.goto(url, { waitUntil: "load" });
  // The `.reveal` elements fade/slide in via IntersectionObserver as they scroll
  // into view; a full-page shot would otherwise capture below-fold sections
  // mid-reveal. Force every reveal to its final state so the baseline is stable.
  await page.addStyleTag({
    content: ".reveal{opacity:1 !important; transform:none !important; animation:none !important}",
  });
  await expect(page).toHaveScreenshot("landing-full.png", {
    fullPage: true,
    // The two JS-driven regions that never settle: the hero demo popup cycles
    // its recording state, and #shiftWave paints an idle waveform shimmer.
    mask: [page.locator("section.hero openjam-popup"), page.locator("#shiftWave")],
    maxDiffPixelRatio: 0.01,
  });
});
