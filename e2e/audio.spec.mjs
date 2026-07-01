// End-to-end audio-narration suite (#8): loads the real unpacked extension with
// a synthetic microphone (see harness --use-fake-*-for-media-stream), and
// verifies the capture→export path — toggle persistence, offscreen-document
// lifecycle, the report.audio payload, and the export carrying the audio.
//
//   npm run build && npx playwright test e2e/audio.spec.mjs
import { test, expect } from "@playwright/test";
import { buildReportHTML } from "../report-builder.js";
import {
  launchExtension,
  serveFixture,
  openPopup,
  tabIdOf,
  sendAction,
} from "../test/e2e/harness.mjs";

test.describe.configure({ mode: "serial" }); // one browser, recordings are global state

let context, extensionId, fixtureServer;

test.beforeAll(async () => {
  ({ context, extensionId } = await launchExtension());
  fixtureServer = await serveFixture();
});

test.afterAll(async () => {
  await context?.close();
  await fixtureServer?.close();
});

// chrome.offscreen lives in the service-worker context, not the popup page.
function serviceWorker() {
  return context.serviceWorkers()[0];
}
function hasOffscreenDocument() {
  return serviceWorker().evaluate(() => chrome.offscreen.hasDocument());
}

async function setAudioSettings(popup, value) {
  await popup.evaluate((v) => chrome.storage.local.set({ audioSettings: v }), value);
}
async function getAudioSettings(popup) {
  return popup.evaluate(async () => (await chrome.storage.local.get("audioSettings")).audioSettings);
}
async function clearAudioSettings(popup) {
  await popup.evaluate(() => chrome.storage.local.remove("audioSettings"));
}

// Reads the single saved report out of storage (background keys it report-<startWall>).
async function readReport(popup) {
  return popup.evaluate(async () => {
    const all = await chrome.storage.local.get(null);
    const key = Object.keys(all).find((k) => k.startsWith("report-"));
    return key ? all[key] : null;
  });
}
async function clearReports(popup) {
  await popup.evaluate(async () => {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter((k) => k.startsWith("report-") || k === "lastReportKey");
    if (keys.length) await chrome.storage.local.remove(keys);
  });
}

// Drives a start→short-activity→stop recording of the fixture and returns the
// saved report. Does NOT open the viewer (audio spec doesn't need it).
async function recordOnce(popup) {
  const fixture = await context.newPage();
  await fixture.goto(fixtureServer.url, { waitUntil: "load" });
  const tabId = await tabIdOf(popup, fixtureServer.url);
  const started = await sendAction(popup, { action: "start", tabId });
  expect(started.ok).toBe(true);
  await fixture.bringToFront();
  await fixture.locator("#inc").click();
  await fixture.waitForTimeout(600);
  return { fixture, tabId };
}

// ---- AC 1: toggle persists ------------------------------------------------

test("audio toggle persists across popup reopen", async () => {
  const popup = await openPopup(context, extensionId);
  await clearAudioSettings(popup);

  // Checking the box grants the (fake) mic, saves audioSettings.enabled=true,
  // and reveals the mic picker. --use-fake-ui-for-media-stream auto-accepts.
  await popup.locator("#audioToggle").check();
  await expect(popup.locator("#audioToggle")).toBeChecked();
  // First interaction on a freshly-launched service worker: the async change
  // handler (getUserMedia + enumerateDevices + storage.set) can lag while the
  // SW warms up, so give this poll extra headroom.
  await expect.poll(async () => (await getAudioSettings(popup))?.enabled, { timeout: 15_000 }).toBe(true);

  await popup.close();
  const reopened = await openPopup(context, extensionId);
  await expect(reopened.locator("#audioToggle")).toBeChecked();
  expect((await getAudioSettings(reopened))?.enabled).toBe(true);
  await reopened.close();
});

test("[disconfirming] fresh context: toggle unchecked and mic picker hidden", async () => {
  const popup = await openPopup(context, extensionId);
  await clearAudioSettings(popup);
  await popup.close();

  const fresh = await openPopup(context, extensionId);
  await expect(fresh.locator("#audioToggle")).not.toBeChecked();
  await expect(fresh.locator("#micSelect")).toHaveAttribute("hidden", "");
  await fresh.close();
});

// ---- AC 2: offscreen-document lifecycle -----------------------------------

test("offscreen document opens on record start and closes on stop", async () => {
  const popup = await openPopup(context, extensionId);
  await setAudioSettings(popup, { enabled: true, deviceId: null });
  await clearReports(popup);

  expect(await hasOffscreenDocument()).toBe(false);
  const { fixture } = await recordOnce(popup);

  // startAudioRecorder creates offscreen.html when audioSettings.enabled.
  await expect.poll(hasOffscreenDocument, { timeout: 10_000 }).toBe(true);

  await sendAction(popup, { action: "stop" });
  // stopRecording -> stopAudioRecorder -> chrome.offscreen.closeDocument().
  await expect.poll(hasOffscreenDocument, { timeout: 10_000 }).toBe(false);

  await fixture.close();
  await popup.close();
});

test("[disconfirming] audio disabled: no offscreen document through a recording", async () => {
  const popup = await openPopup(context, extensionId);
  await setAudioSettings(popup, { enabled: false, deviceId: null });
  await clearReports(popup);

  expect(await hasOffscreenDocument()).toBe(false);
  const { fixture } = await recordOnce(popup);
  expect(await hasOffscreenDocument()).toBe(false);
  await sendAction(popup, { action: "stop" });
  expect(await hasOffscreenDocument()).toBe(false);

  await fixture.close();
  await popup.close();
});

// ---- AC 3: report.audio payload -------------------------------------------

test("audio-enabled recording writes report.audio with a webm data URL", async () => {
  const popup = await openPopup(context, extensionId);
  await setAudioSettings(popup, { enabled: true, deviceId: null });
  await clearReports(popup);

  const { fixture } = await recordOnce(popup);
  await sendAction(popup, { action: "stop" });
  await expect.poll(hasOffscreenDocument, { timeout: 10_000 }).toBe(false);

  const report = await readReport(popup);
  expect(report).not.toBeNull();
  expect(report.audio).not.toBeNull();
  // A fake-device clip may be tiny — assert shape, not size.
  expect(report.audio.mime).toMatch(/^audio\/webm/);
  expect(report.audio.durationMs).toBeGreaterThanOrEqual(0);
  expect(report.audio.dataUrl).toMatch(/^data:audio\/webm/);

  await fixture.close();
  await popup.close();
});

test("[disconfirming] audio-disabled recording writes report.audio === null", async () => {
  const popup = await openPopup(context, extensionId);
  await setAudioSettings(popup, { enabled: false, deviceId: null });
  await clearReports(popup);

  const { fixture } = await recordOnce(popup);
  await sendAction(popup, { action: "stop" });

  const report = await readReport(popup);
  expect(report).not.toBeNull();
  expect(report.audio).toBeNull();

  await fixture.close();
  await popup.close();
});

// ---- AC 4: export shape ---------------------------------------------------
// Note: report-builder does NOT emit a static <audio src="data:audio/webm">.
// The <audio> element is created at runtime by mountAudio(); the export instead
// carries an #audio-section container, the embedded report JSON (which holds the
// data:audio/webm URL exactly once), and the mountAudio bootstrap script. So the
// task's literal regex `/<audio[^>]*src="data:audio\/webm/` matches ZERO times
// in the built string — see the "runtime mount" test below, which renders the
// export and asserts the real runtime <audio> element the user actually gets.
// This is a pure build assertion — it needs no live media.

const AUDIO_REPORT = {
  meta: { version: "0.4.2", capturedAt: 1, durationMs: 10, pageUrl: "x", pageTitle: "t", eventCount: 1 },
  device: {},
  events: [],
  rrwebEvents: [],
  audio: { dataUrl: "data:audio/webm;base64,AAAA", mime: "audio/webm;codecs=opus", startWall: 1, durationMs: 5 },
};

test("export from an audio report carries the audio section and data URL exactly once", () => {
  const html = buildReportHTML(AUDIO_REPORT, null);
  expect(html).toContain('id="audio-section"');
  // The webm data URL is embedded once (in the report JSON that mountAudio reads).
  expect(html.match(/data:audio\/webm/g)).toHaveLength(1);
});

test("[disconfirming] export from a null-audio report has no audio section or data URL", () => {
  const html = buildReportHTML({ ...AUDIO_REPORT, audio: null }, null);
  expect(html).not.toContain('id="audio-section"');
  expect(html.match(/data:audio\/webm/g)).toBeNull();
});

test("with a replay, there is no standalone audio player — the replayer drives the audio", () => {
  // One-player invariant: when a report has a replay, narration is driven by the
  // replayer (play/pause/seek/speed move both), so no separate #audio-section.
  const replayReport = { ...AUDIO_REPORT, rrwebEvents: [{ type: 4, timestamp: 1 }, { type: 3, timestamp: 2 }] };
  const stubAssets = { ENGINE_IIFE: "window.RRWebReplayer=function(){};", ENGINE_CSS: "" };
  const html = buildReportHTML(replayReport, stubAssets);
  expect(html).toContain('id="replay-section"');
  expect(html).not.toContain('id="audio-section"');
  // The webm data URL is still inlined once (in the report JSON the replayer reads).
  expect(html.match(/data:audio\/webm/g)).toHaveLength(1);
});

test("export renders a runtime <audio src=data:audio/webm> element in a browser", async () => {
  // The true export shape: opened in a browser, mountAudio must create exactly
  // one <audio> element sourced from the webm data URL. Rendered from a fixed
  // report, so no live media is involved.
  const html = buildReportHTML(AUDIO_REPORT, null);
  const page = await context.newPage();
  await page.setContent(html, { waitUntil: "domcontentloaded" });
  const audios = page.locator("#audio-section audio");
  await expect(audios).toHaveCount(1);
  await expect(audios).toHaveAttribute("src", /^data:audio\/webm/);
  await page.close();
});

test("[disconfirming] export of a null-audio report renders no <audio> element", async () => {
  const html = buildReportHTML({ ...AUDIO_REPORT, audio: null }, null);
  const page = await context.newPage();
  await page.setContent(html, { waitUntil: "domcontentloaded" });
  await expect(page.locator("audio")).toHaveCount(0);
  await page.close();
});
