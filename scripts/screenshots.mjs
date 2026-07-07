// Regenerates docs/screenshots/*.png by driving the real extension in
// Chromium via Playwright (shared harness: test/e2e/harness.mjs): load
// unpacked → record the e2e fixture → stop → screenshot the popup and the
// report viewer. Store-listing shots (viewer) are 1280x800, the Chrome Web
// Store screenshot size (https://developer.chrome.com/docs/webstore/images).
//
//   npm run build && npm run screenshots
//
// HEADFUL=1 to watch it run. Requires `npx playwright install chromium`.
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import {
  ROOT,
  launchExtension,
  serveFixture,
  openPopup,
  tabIdOf,
  sendAction,
  stopAndOpenViewer,
} from "../test/e2e/harness.mjs";

const OUT = path.join(ROOT, "docs", "screenshots");

if (!existsSync(path.join(ROOT, "dist", "rrweb-recorder.js"))) {
  console.error("dist/rrweb-recorder.js missing — run `npm run build` first");
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const fixtureServer = await serveFixture();
const { context, extensionId } = await launchExtension();

try {
  const fixture = await context.newPage();
  await fixture.goto(fixtureServer.url, { waitUntil: "load" });

  const popup = await openPopup(context, extensionId);
  await popup.screenshot({ path: path.join(OUT, "popup-idle.png") });

  // Enable narration through the real toggle so the shots show the checked box
  // and mic picker, and the recording carries audio → the viewer waveform strip.
  // The harness launches with --use-fake-device-for-media-stream (a synthetic
  // tone) + auto-granted mic, so this records a real, decodable clip — no device.
  await popup.locator("[data-act=mic]").click();
  await popup.locator("[data-act=mic][aria-checked=true]").waitFor();
  await popup.locator("openjam-popup select").waitFor(); // mic picker revealed

  const tabId = await tabIdOf(popup, fixtureServer.url);
  const started = await sendAction(popup, { action: "start", tabId });
  if (!started.ok) throw new Error("start failed: " + started.error);

  // Generate console + rrweb material on the fixture.
  await fixture.bringToFront();
  await fixture.locator("#name").fill("Ada Lovelace");
  for (let i = 0; i < 3; i++) await fixture.locator("#inc").click();
  await fixture.waitForTimeout(1200); // let rrweb flush mutation batches

  await sendAction(popup, { action: "screenshot" });

  // The popup polls getStatus every second; wait for it to show recording.
  await popup.bringToFront();
  await popup.locator("openjam-popup [data-act=toggle]", { hasText: "Stop & open report" }).waitFor();
  await popup.screenshot({ path: path.join(OUT, "popup-recording.png") });

  const viewer = await stopAndOpenViewer(context, popup);
  await viewer.locator(".row").first().waitFor();
  await viewer.locator("#replay .replayer-wrapper").waitFor();
  const waveform = viewer.locator("#replay .oj-waveform"); // narration → waveform strip
  await waveform.waitFor();
  await viewer.waitForTimeout(800); // replay first frame + waveform peaks paint
  // The waveform sits under the scrub bar, below the 800px store-listing crop —
  // scroll the player controls into view so the shot shows the audio feature.
  await waveform.scrollIntoViewIfNeeded();
  await viewer.screenshot({ path: path.join(OUT, "viewer.png") });

  await viewer.locator(".row", { hasText: "counter is now" }).first().click();
  await viewer.locator(".detail").first().waitFor();
  await viewer.screenshot({ path: path.join(OUT, "viewer-expanded.png") });

  console.log("wrote 4 screenshots to", OUT);
} finally {
  await context.close();
  await fixtureServer.close();
}
