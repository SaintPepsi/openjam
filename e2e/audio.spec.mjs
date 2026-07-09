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

  // Toggling the mic switch grants the (fake) mic, saves audioSettings.enabled=true,
  // and reveals the mic picker. --use-fake-ui-for-media-stream auto-accepts.
  await popup.locator("[data-act=mic]").click();
  await expect(popup.locator("[data-act=mic]")).toHaveAttribute("aria-checked", "true");
  // First interaction on a freshly-launched service worker: the async change
  // handler (getUserMedia + enumerateDevices + storage.set) can lag while the
  // SW warms up, so give this poll extra headroom.
  await expect.poll(async () => (await getAudioSettings(popup))?.enabled, { timeout: 15_000 }).toBe(true);

  await popup.close();
  const reopened = await openPopup(context, extensionId);
  await expect(reopened.locator("[data-act=mic]")).toHaveAttribute("aria-checked", "true");
  expect((await getAudioSettings(reopened))?.enabled).toBe(true);
  await reopened.close();
});

test("[disconfirming] fresh context: toggle unchecked and mic picker hidden", async () => {
  const popup = await openPopup(context, extensionId);
  await clearAudioSettings(popup);
  await popup.close();

  const fresh = await openPopup(context, extensionId);
  await expect(fresh.locator("[data-act=mic]")).toHaveAttribute("aria-checked", "false");
  // Without [mic] on the host the picker stays collapsed (max-height:0) — the
  // component's way of hiding the mic list.
  expect(await fresh.locator("openjam-popup").evaluate((el) => el.hasAttribute("mic"))).toBe(false);
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

test("replay player with audio renders a waveform, volume control, and hover-time in a browser", async () => {
  // The replay-driven player gains three audio affordances: a waveform canvas as
  // the scrubber background (visible cue that narration exists), a volume/mute
  // control, and a hover-timestamp tooltip. A stub replayer satisfies the engine
  // interface; the invalid tiny data URL fails decode, so we assert the ELEMENTS
  // exist (created before decode) rather than the drawn bars.
  const replayReport = { ...AUDIO_REPORT, rrwebEvents: [{ type: 4, timestamp: 1 }, { type: 3, timestamp: 2 }] };
  const stubAssets = {
    ENGINE_IIFE:
      "window.RRWebReplayer=function(){return{getMetaData:function(){return{totalTime:1000}}," +
      "getCurrentTime:function(){return 0},on:function(){},pause:function(){},play:function(){},setConfig:function(){}};};",
    ENGINE_CSS: "",
  };
  const html = buildReportHTML(replayReport, stubAssets);
  const page = await context.newPage();
  await page.setContent(html, { waitUntil: "load" });
  // Original scrub bar is untouched; the waveform is a separate strip beneath it.
  await expect(page.locator("#replay .oj-progress")).toHaveCount(1);
  await expect(page.locator("#replay .oj-waveform")).toHaveCount(1);
  await expect(page.locator("#replay .oj-waveform canvas.oj-wave")).toHaveCount(1);
  await expect(page.locator("#replay .oj-vol")).toHaveCount(1);
  await expect(page.locator("#replay .oj-controls button.oj-icon")).toHaveCount(1);
  // Hover-time tooltip on both the scrub bar and the waveform strip.
  await expect(page.locator("#replay .oj-hover-time")).toHaveCount(2);
  // Audio-sync diagnostics block renders and the replayer fills totalTime.
  await expect(page.getByText("Audio sync diagnostics")).toHaveCount(1);
  await expect(page.locator("#oj-diag-total")).toHaveText(/\d+ ms/);
  await page.close();
});

test("timeline spans narration that outlasts the replay, and the wave tooltip renders inside the strip", async () => {
  // You usually keep talking after the screen stops changing. The one timeline
  // must span the LONGER of replay and narration or the tail is unreachable:
  // stub replay span = 1000ms, narration window = 3200ms → total shows 0:03.
  const stubAssets = {
    ENGINE_IIFE:
      "window.RRWebReplayer=function(){return{getMetaData:function(){return{totalTime:1000}}," +
      "getCurrentTime:function(){return 0},on:function(){},pause:function(){},play:function(){},setConfig:function(){}};};",
    ENGINE_CSS: "",
  };
  const longAudio = {
    ...AUDIO_REPORT,
    audio: { ...AUDIO_REPORT.audio, startWall: 1, durationMs: 3200 },
    rrwebEvents: [{ type: 4, timestamp: 1 }, { type: 3, timestamp: 2 }],
  };
  const page = await context.newPage();
  await page.setContent(buildReportHTML(longAudio, stubAssets), { waitUntil: "load" });
  await expect(page.locator("#replay .oj-time")).toHaveText("0:00 / 0:03");

  // Hovering the waveform strip shows the timestamp tooltip INSIDE the strip —
  // the strip clips overflow, so a tip above its top edge would be invisible.
  const strip = page.locator("#replay .oj-waveform");
  await strip.hover({ position: { x: 120, y: 22 } });
  const tip = page.locator("#replay .oj-waveform .oj-hover-time");
  await expect(tip).toBeVisible();
  await expect(tip).toHaveText(/\d:\d\d/);
  const tipBox = await tip.boundingBox();
  const stripBox = await strip.boundingBox();
  expect(tipBox.y).toBeGreaterThanOrEqual(stripBox.y);
  expect(tipBox.y + tipBox.height).toBeLessThanOrEqual(stripBox.y + stripBox.height + 1);

  // Disconfirming: narration shorter than the replay leaves the replay's span.
  const shortAudio = {
    ...AUDIO_REPORT,
    rrwebEvents: [{ type: 4, timestamp: 1 }, { type: 3, timestamp: 2 }],
  };
  await page.setContent(buildReportHTML(shortAudio, stubAssets), { waitUntil: "load" });
  await expect(page.locator("#replay .oj-time")).toHaveText("0:00 / 0:01");
  await page.close();
});

// A replayer stub whose clock actually ADVANCES (1000ms span, real time × speed,
// fires "finish" at the end) — the static stub above can't exercise playback.
const ADVANCING_STUB =
  "window.RRWebReplayer=function(){" +
  "var base=0,startAt=0,playing=false,speed=1,handlers={};" +
  "function cur(){return playing?Math.min(base+(Date.now()-startAt)*speed,1000):base;}" +
  "return{getMetaData:function(){return{totalTime:1000}}," +
  "getCurrentTime:function(){var t=cur();" +
  "if(playing&&t>=1000){base=1000;playing=false;if(handlers.finish)setTimeout(handlers.finish,0);}" +
  "return t;}," +
  "play:function(t){if(t!=null)base=t;startAt=Date.now();playing=true;}," +
  "pause:function(t){base=t!=null?t:cur();playing=false;}," +
  "setConfig:function(c){base=cur();startAt=Date.now();if(c&&c.speed)speed=c.speed;}," +
  "on:function(ev,fn){handlers[ev]=fn;}};};";

// Minimal PCM WAV of silence — decodeAudioData accepts it, so the REAL audio
// path (decode → buffer playback → syncAudio) runs, unlike the 4-byte webm.
function silentWavDataUrl(seconds, rate = 8000) {
  const n = Math.floor(seconds * rate);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  return "data:audio/wav;base64," + buf.toString("base64");
}

test("playback runs through the replay's end, out the narration tail, without stacking paint loops", async () => {
  // The whole point of the feature is the clock — drive a real play-through:
  // replay span 1000ms, decodable 3.2s narration, so play must cross the
  // replay's end into the tail and finish at the narration's end.
  const report = {
    ...AUDIO_REPORT,
    audio: { dataUrl: silentWavDataUrl(3.2), mime: "audio/wav", startWall: 1, durationMs: 3200 },
    rrwebEvents: [{ type: 4, timestamp: 1 }, { type: 3, timestamp: 2 }],
  };
  const page = await context.newPage();
  await page.setContent(buildReportHTML(report, { ENGINE_IIFE: ADVANCING_STUB, ENGINE_CSS: "" }), { waitUntil: "load" });
  // Track rAF callbacks that are scheduled but not yet fired/cancelled. Installed
  // after load but before Play: the paused player has no pending frame yet and
  // looks rAF up at call time, so every playback frame goes through the tracker.
  await page.evaluate(() => {
    const live = new Set();
    const req = window.requestAnimationFrame.bind(window);
    const can = window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => {
      const id = req((ts) => { live.delete(id); cb(ts); });
      live.add(id);
      return id;
    };
    window.cancelAnimationFrame = (id) => { live.delete(id); can(id); };
    window.__ojPendingFrames = () => live.size;
  });
  const label = page.locator("#replay .oj-time");
  await expect(label).toHaveText("0:00 / 0:03");

  await page.locator("#replay .oj-controls button", { hasText: "Play" }).click();
  // Scrubbing while playing must not stack extra paint loops — each leaked loop
  // drags a full waveform repaint per frame. After 5 seeks: at most one pending.
  const progress = page.locator("#replay .oj-progress");
  for (let i = 0; i < 5; i++) await progress.click({ position: { x: 30, y: 4 } });
  expect(await page.evaluate(() => window.__ojPendingFrames())).toBeLessThanOrEqual(1);

  // The replay's clock caps at 1000ms (0:01) — reaching 0:02 proves the tail
  // wall-clock took over past the replay's end. (Disconfirming: without the
  // master timeline this label can never exceed 0:01.)
  await expect(label).toHaveText(/^0:02 \//, { timeout: 8000 });

  // Pause inside the tail holds position…
  await page.locator("#replay .oj-controls button", { hasText: "Pause" }).click();
  const frozen = await label.textContent();
  await page.waitForTimeout(300);
  await expect(label).toHaveText(frozen);

  // …and resume runs the tail out to the narration's end.
  await page.locator("#replay .oj-controls button", { hasText: "Play" }).click();
  await expect(page.locator("#replay .oj-controls button", { hasText: "↺ Replay" })).toBeVisible({ timeout: 8000 });
  await expect(label).toHaveText("0:03 / 0:03");
  expect(await page.evaluate(() => window.__ojPendingFrames())).toBe(0);
  await page.close();
});

test("[disconfirming] replay player without audio has no waveform or volume control", async () => {
  const replayReport = { ...AUDIO_REPORT, audio: null, rrwebEvents: [{ type: 4, timestamp: 1 }, { type: 3, timestamp: 2 }] };
  const stubAssets = {
    ENGINE_IIFE:
      "window.RRWebReplayer=function(){return{getMetaData:function(){return{totalTime:1000}}," +
      "getCurrentTime:function(){return 0},on:function(){},pause:function(){},play:function(){},setConfig:function(){}};};",
    ENGINE_CSS: "",
  };
  const html = buildReportHTML(replayReport, stubAssets);
  const page = await context.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await expect(page.locator("#replay .oj-waveform")).toHaveCount(0);
  await expect(page.locator("#replay canvas.oj-wave")).toHaveCount(0);
  await expect(page.locator("#replay .oj-vol")).toHaveCount(0);
  // The scrub bar and its hover-time tooltip stay — useful for replay-only reports.
  await expect(page.locator("#replay .oj-progress")).toHaveCount(1);
  await expect(page.locator("#replay .oj-hover-time")).toHaveCount(1);
  // No audio → no sync diagnostics.
  await expect(page.getByText("Audio sync diagnostics")).toHaveCount(0);
  await page.close();
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

// ---- AC 5 (ticket 03): mic narration state recovery -----------------------
// The harness launches with --use-fake-ui-for-media-stream, which makes
// navigator.permissions.query report the mic as "granted" even after
// context.clearPermissions(). To exercise the no-grant path we simulate a
// missing grant at the API popup.js actually reads (permissions.query), the
// same spirit as the harness faking the media device, then reload so
// popup.js re-runs against it.
async function openPopupNoGrant(seedSettings) {
  const popup = await openPopup(context, extensionId);
  if (seedSettings === undefined) await clearAudioSettings(popup);
  else await setAudioSettings(popup, seedSettings);
  await popup.addInitScript(() => {
    const real = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (d) =>
      d && d.name === "microphone" ? Promise.resolve({ state: "prompt", onchange: null }) : real(d);
  });
  await popup.reload();
  await popup.locator("openjam-popup").waitFor();
  await popup.waitForFunction(() => {
    const el = document.querySelector("openjam-popup");
    return !!el?.shadowRoot?.querySelector("button");
  });
  return popup;
}

// Problem A: on a missing grant, loadAudio must not render the switch ON above
// an empty, expanded picker. Fork (Ian to ratify): reflect the switch OFF with
// a visible hint, rather than keep it ON and reopen the grant flow.
test("revoked permission with audioSettings.enabled: switch OFF and a visible grant hint", async () => {
  const popup = await openPopupNoGrant({ enabled: true, deviceId: null });
  // The hint appears only from the fixed loadAudio path; asserting it first also
  // proves loadAudio settled before we read the switch (default is already OFF).
  await expect(popup.locator("openjam-popup").locator(".notice.warn")).toBeVisible();
  await expect(popup.locator("[data-act=mic]")).toHaveAttribute("aria-checked", "false");
  await popup.close();
});

// Problem B: the mic-toggle handler must clear the stale grant error when the
// user toggles narration back off (and on a later successful listMics).
test("mic grant error clears when narration is toggled back off", async () => {
  const popup = await openPopupNoGrant();

  const err = popup.locator("openjam-popup").locator(".notice.err");
  // Toggle ON with no grant: handler opens the focused permission tab and shows
  // the "Opening a tab to grant microphone access…" error.
  const micTab = context.waitForEvent("page").catch(() => null);
  await popup.locator("[data-act=mic]").click();
  await expect(err).toBeVisible();

  // Toggle back OFF: the error describes a flow the user just abandoned, so it
  // must clear (disconfirming input: drop the showError("") on the uncheck path
  // and this assertion fails — the notice stays visible).
  await popup.locator("[data-act=mic]").click();
  await expect(err).toBeHidden();

  const tab = await micTab;
  if (tab) await tab.close();
  await popup.close();
});
