// Regenerates docs/screenshots/*.png by driving the real extension in
// Chromium via Playwright: load unpacked → record the e2e fixture → stop →
// screenshot the popup and the report viewer. Store-listing shots (viewer)
// are 1280x800, the Chrome Web Store screenshot size
// (https://developer.chrome.com/docs/webstore/images).
//
//   npm run build && npm run screenshots
//
// HEADFUL=1 to watch it run. Requires `npx playwright install chromium`.
import { createServer } from "node:http";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, "docs", "screenshots");
const FIXTURE = readFileSync(path.join(ROOT, "test", "e2e", "fixture.html"));

if (!existsSync(path.join(ROOT, "dist", "rrweb-recorder.js"))) {
  console.error("dist/rrweb-recorder.js missing — run `npm run build` first");
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

// Serve the deterministic fixture over http (content scripts don't run on
// file:// without the user opting in).
const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end(FIXTURE);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const fixtureUrl = `http://127.0.0.1:${server.address().port}/`;

// Extensions need a persistent context, and `channel: "chromium"` selects
// the full browser whose new headless mode supports extensions — the default
// headless shell does not (https://playwright.dev/docs/chrome-extensions).
const context = await chromium.launchPersistentContext("", {
  channel: "chromium",
  headless: !process.env.HEADFUL,
  viewport: { width: 1280, height: 800 },
  args: [
    `--disable-extensions-except=${ROOT}`,
    `--load-extension=${ROOT}`,
  ],
});

try {
  const sw =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  const extensionId = new URL(sw.url()).host;

  const fixture = await context.newPage();
  await fixture.goto(fixtureUrl, { waitUntil: "load" });

  // popup.html opened as a tab doubles as the control surface: it can
  // chrome.runtime.sendMessage the background worker, and chrome.tabs.query
  // resolves the fixture's tabId for the explicit-tab `start` message.
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 360, height: 440 });
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.locator("#toggle").waitFor();
  await popup.screenshot({ path: path.join(OUT, "popup-idle.png") });

  const fixtureTabId = await popup.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url: url + "*" });
    return tab.id;
  }, fixtureUrl);

  const started = await popup.evaluate(
    (tabId) => chrome.runtime.sendMessage({ action: "start", tabId }),
    fixtureTabId,
  );
  if (!started.ok) throw new Error("start failed: " + started.error);

  // Generate console + rrweb material on the fixture.
  await fixture.bringToFront();
  await fixture.locator("#name").fill("Ada Lovelace");
  for (let i = 0; i < 3; i++) await fixture.locator("#inc").click();
  await fixture.waitForTimeout(1200); // let rrweb flush mutation batches

  await popup.evaluate(() => chrome.runtime.sendMessage({ action: "screenshot" }));

  // The popup polls getStatus every second; wait for it to show recording.
  await popup.bringToFront();
  await popup.locator("#toggle", { hasText: "Stop & open report" }).waitFor();
  await popup.screenshot({ path: path.join(OUT, "popup-recording.png") });

  const [viewer] = await Promise.all([
    context.waitForEvent("page"),
    popup.evaluate(() => chrome.runtime.sendMessage({ action: "stop" })),
  ]);
  await viewer.waitForURL(/viewer\.html/);
  await viewer.setViewportSize({ width: 1280, height: 800 });
  await viewer.locator(".row").first().waitFor();
  await viewer.locator("#replay .replayer-wrapper").waitFor();
  await viewer.waitForTimeout(500); // replay first frame
  await viewer.screenshot({ path: path.join(OUT, "viewer.png") });

  await viewer.locator(".row", { hasText: "counter is now" }).first().click();
  await viewer.locator(".detail").first().waitFor();
  await viewer.screenshot({ path: path.join(OUT, "viewer-expanded.png") });

  console.log("wrote 4 screenshots to", OUT);
} finally {
  await context.close();
  server.close();
}
