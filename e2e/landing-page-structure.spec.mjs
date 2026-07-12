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

// Disconfirming input: change toHaveCount(4) to toHaveCount(5), or delete one
// <install-cta> from docs/index.html and rebuild — the count assertion fails
// (verified: toHaveCount(5) failed on ctas, "Expected: 5, Received: 4").
test("install CTAs render a logo + label and link to the Chrome Web Store", async ({ page }) => {
  await page.goto(url, { waitUntil: "load" });
  const ctas = page.locator("install-cta a.btn");
  await expect(ctas).toHaveCount(4);                    // nav, hero, step 1, final
  const first = ctas.first();
  await expect(first).toHaveAttribute("href", /chromewebstore\.google\.com\/detail\/openjam/);
  await expect(first.locator(".cta-ic svg")).toBeVisible();   // real logo, not empty
  await expect(first.locator(".cta-label")).toHaveText(/Add to Chrome/); // Chromium engine → Chrome
});

// Playwright overrides the UA per test via test.use({ userAgent }) so we drive
// the real pickBrowser() path in the page. Disconfirming input: remove the
// test.use line below — the default Chrome UA relabels to "Add to Chrome" and
// this assertion fails (verified: without the spoof it read "Add to Chrome").
test.describe("browser relabel", () => {
  test.use({ userAgent: "Mozilla/5.0 (X11) Chrome/126.0.0.0 Safari/537.36 Vivaldi/6.7" });
  test("Vivaldi UA relabels every CTA to 'Add to Vivaldi'", async ({ page }) => {
    await page.goto(url, { waitUntil: "load" });
    const labels = page.locator("install-cta .cta-label");
    await expect(labels.first()).toHaveText("Add to Vivaldi");
  });
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
  // The hero demo <openjam-popup> is masked (its pixels are ignored) but NOT
  // out of flow: it sits in the hero column, so its height feeds the page
  // height. Its demo mode re-renders on a 1s timer, each time restarting
  // .mic-body's `max-height` transition; Playwright's sub-second stabilization
  // shots then catch the popup at different heights, so the full-page image
  // dimensions oscillate (~12px) and never stabilize — the real failure, not
  // font drift. Kill transitions/animations inside the popup's shadow root so
  // its height snaps to the settled value and holds across every re-render.
  await page.evaluate(() => {
    const root = document.querySelector("section.hero openjam-popup")?.shadowRoot;
    if (!root) throw new Error("popup shadow root not found — selector drifted");
    const style = document.createElement("style");
    style.textContent = "*,*::before,*::after{transition:none !important; animation:none !important}";
    root.appendChild(style);
  });
  await expect(page).toHaveScreenshot("landing-full.png", {
    fullPage: true,
    // The two non-deterministic regions: the hero demo popup cycles its recording
    // state, and #shiftWave is an <oj-waveform> whose <canvas> content depends on
    // the mp3 decode/playback (here the easter-egg mp3 404s, so it stays empty) —
    // its rendered pixels vary across environments, so mask it.
    mask: [page.locator("section.hero openjam-popup"), page.locator("#shiftWave")],
    maxDiffPixelRatio: 0.01,
  });
});
