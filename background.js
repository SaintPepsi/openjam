// OpenJam capture engine.
// Attaches the Chrome DevTools Protocol to the active tab and records console
// logs, network requests, JS errors and screenshots onto one wall-clock timeline.

import { KIND } from "./event-kinds.js";
import { createCdpLane } from "./src/lanes/cdp.js";
import { createInjectLane } from "./src/lanes/inject.js";
import { foreignExtensionIds, listExtensionFrameSrcs } from "./src/foreign-frames.js";

const SCREENSHOT_ON_ERROR_COOLDOWN_MS = 2000;

const session = {
  recording: false,
  stopping: false, // guards re-entrant stopRecording during the grace window
  capture: null, // "cdp" | "inject" — the one signal for which lane this session runs on
  lane: null, // the lane object itself (see src/lanes/)
  tabId: null,
  startWall: null, // epoch ms when recording began
  monoOffset: null, // wallMs - (monotonic seconds * 1000), set on first network event
  seq: 0,
  events: [], // unified timeline
  rrwebEvents: [], // rrweb session-replay events (timestamps are Date.now() epoch ms)
  requestEvents: new Map(), // requestId -> network event reference
  device: null,
  lastErrorShot: 0,
  audioActive: false,
};

function nextId() {
  session.seq += 1;
  return session.seq;
}

function pushEvent(event) {
  const full = { id: nextId(), rel: event.t - session.startWall, ...event };
  session.events.push(full);
  return full;
}


// Null-safe: a stop or manual screenshot can land while startRecording is still
// attaching (no lane yet). Record the miss instead of throwing past the
// stopping/finalize bookkeeping, which used to wedge the session.
function captureScreenshot(label) {
  if (!session.lane) {
    pushEvent({ t: Date.now(), kind: KIND.SCREENSHOT, title: label + " (failed)", detail: { error: "no capture lane active" } });
    return Promise.resolve();
  }
  return session.lane.screenshot(label);
}

// MV3 evicts an idle worker after ~30 s. On the cdp lane the debugger session
// pins it; on the inject lane nothing does, and rrweb/probe batches only flow
// while the page changes. Any extension API call resets the idle timer, so tick
// one while recording (lane-agnostic: harmless on cdp).
const KEEP_ALIVE_MS = 20_000;
let keepAliveTimer = null;
function startKeepAlive() {
  stopKeepAlive();
  keepAliveTimer = setInterval(() => {
    try {
      chrome.runtime.getPlatformInfo(() => {});
    } catch {
      // worker shutting down — nothing to keep alive
    }
  }, KEEP_ALIVE_MS);
}
function stopKeepAlive() {
  if (keepAliveTimer) clearInterval(keepAliveTimer);
  keepAliveTimer = null;
}

function maybeErrorScreenshot() {
  const now = Date.now();
  if (now - session.lastErrorShot < SCREENSHOT_ON_ERROR_COOLDOWN_MS) return;
  session.lastErrorShot = now;
  captureScreenshot("Auto-captured on error");
}

const cdpLane = createCdpLane({ session, pushEvent, maybeErrorScreenshot });
const injectLane = createInjectLane({ session, pushEvent, maybeErrorScreenshot, ensureContentScripts });

// Content scripts can be absent (extension reloaded after the page loaded, or a
// page the manifest match didn't reach). Inject both halves: the rrweb recorder
// into the MAIN world (it patches the page's own stylesheet prototypes), the
// relay into the isolated world (for chrome.*). The page probe is NOT here: the
// inject lane adds it only to the tab it records (src/lanes/inject.js).
async function ensureContentScripts(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["dist/rrweb-recorder.js"], world: "MAIN" });
  await chrome.scripting.executeScript({ target: { tabId }, files: ["dist/rrweb-relay.js"] });
}

// ---- rrweb replay recorder ------------------------------------------------

async function startReplayRecorder(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { action: "oj-rrweb-start" });
  } catch {
    // Content scripts absent (e.g. extension was reloaded after the page
    // loaded, or a restricted page). Inject them and retry once.
    try {
      await ensureContentScripts(tabId);
      await chrome.tabs.sendMessage(tabId, { action: "oj-rrweb-start" });
    } catch (err) {
      pushEvent({
        t: Date.now(),
        kind: KIND.LOG,
        level: "warning",
        title: "Session replay unavailable on this page",
        detail: { message: String(err) },
      });
    }
  }
}

// ---- mic narration lane (offscreen MediaRecorder) -------------------------

async function startAudioRecorder() {
  const { audioSettings } = await chrome.storage.local.get("audioSettings");
  if (!audioSettings || !audioSettings.enabled) return;
  try {
    if (!(await chrome.offscreen.hasDocument())) {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["USER_MEDIA"],
        justification: "Record microphone narration for a local bug report.",
      });
    }
    const res = await chrome.runtime.sendMessage({ type: "oj-audio-start", deviceId: audioSettings.deviceId || null });
    if (!res || !res.ok) throw new Error((res && res.error) || "audio start failed");
    session.audioActive = true;
  } catch (err) {
    session.audioActive = false;
    try { await chrome.offscreen.closeDocument(); } catch { /* none open */ }
    pushEvent({ t: Date.now(), kind: KIND.LOG, level: "warning", title: "Audio narration unavailable", detail: { message: String(err) } });
  }
}

async function stopAudioRecorder() {
  if (!session.audioActive) return null;
  session.audioActive = false;
  try {
    const res = await chrome.runtime.sendMessage({ type: "oj-audio-stop" });
    return res && res.dataUrl ? res : null;
  } catch {
    return null;
  } finally {
    try { await chrome.offscreen.closeDocument(); } catch { /* already closed */ }
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "oj-rrweb-batch") {
    const accept = session.recording && sender.tab && sender.tab.id === session.tabId;
    // The batch arrives as a JSON string (recorder stringifies it; see
    // src/rrweb-recorder.js — the verified cliff is chrome.storage.local.set's
    // serialization silently nulling JSON nesting deeper than ~100, DOM depth
    // >= 48, so events travel and persist as a string end to end). Parse it back
    // into the in-memory array here, which never touches storage directly. Guard
    // against malformed JSON so one bad batch can't tear down the listener.
    if (accept) {
      try {
        session.rrwebEvents.push(...JSON.parse(msg.eventsJson));
      } catch (err) {
        console.warn("OpenJam: dropped an unparseable rrweb batch", err);
      }
    }
    // {stop:true} tells an orphaned recorder (session ended without it being
    // told, e.g. debug banner dismissed) to stop serializing the page.
    sendResponse(accept ? { ok: true } : { stop: true });
    return;
  }
  if (msg.type === "oj-page-batch") {
    // Probe records from the inject lane. Only that lane accepts them; on the
    // cdp lane the probe is never armed, so this is defence in depth.
    const accept = session.recording && session.capture === "inject" && sender.tab && sender.tab.id === session.tabId;
    if (accept) {
      try {
        session.lane.handleBatch(JSON.parse(msg.eventsJson));
      } catch (err) {
        console.warn("OpenJam: dropped an unparseable probe batch", err);
      }
    }
    sendResponse(accept ? { ok: true } : { stop: true });
    return;
  }
  if (msg.type === "oj-rrweb-hello") {
    // A page (re)loaded; tell its recorder (and, on the inject lane, its probe)
    // to resume if we're mid-recording.
    const ours = session.recording && sender.tab && sender.tab.id === session.tabId;
    const probe = ours && session.capture === "inject";
    // The new document has no probe yet (it is never a manifest script): put one
    // in. The relay arms it when the probe announces probe-ready.
    if (probe) session.lane.injectProbe(sender.tab.id).catch(() => {});
    sendResponse({ record: ours, probe });
    return;
  }
});

// ---- lifecycle ------------------------------------------------------------

// chrome.debugger only attaches to ordinary web pages. Browser UI (chrome://),
// the Web Store, and other extensions' pages (chrome-extension://) reject the
// attach with an opaque CDP error — e.g. "Cannot access a chrome-extension://
// URL of different extension" — so screen them out first with advice the user
// can act on. host_permissions (<all_urls>) leave tab.url undefined for pages
// we can't read, which are exactly the ones we can't record.
async function recordableTabError(tabId) {
  let url;
  try {
    ({ url } = await chrome.tabs.get(tabId));
  } catch {
    return "Couldn't find the tab to record. Open the page you want to capture and try again.";
  }
  if (url && /^(https?|file):/.test(url)) return null;
  return "OpenJam can only record normal web pages, not browser or extension pages. Switch to the tab you want to record, then press Start.";
}

// chrome.debugger.attach vets EVERY frame in the tab, not just the page URL
// (chromium: debugger_api.cc, ExtensionMayAttachToRenderFrameHost). One iframe
// from another extension — a password manager's inline menu, a grammar checker,
// a shopping assistant — makes the whole tab unattachable, while tabs.get still
// reports a normal https URL so recordableTabError() lets it through (#48).
// Chrome offers no way around it, so that one case falls back to the inject
// lane; every other attach failure is unknown territory and still aborts.
const FOREIGN_EXTENSION_FRAME = /chrome-extension:\/\/ URL of different extension/;

// The ids of other extensions with frames in the tab, best effort: frames
// inside closed shadow roots stay invisible and the list comes back empty.
async function scanForeignFrames(tabId) {
  try {
    const results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: listExtensionFrameSrcs });
    return foreignExtensionIds((results || []).flatMap((r) => (r && r.result) || []), chrome.runtime.id);
  } catch {
    return [];
  }
}

function reducedCaptureWarning(blockedBy) {
  const who = blockedBy.length ? "extension " + blockedBy.join(", ") : "another extension";
  return (
    "Recording in reduced mode: " + who + " has content in this page and Chrome blocks its debugger. " +
    "Replay, console, fetch/XHR calls and screenshots of this tab still work; other requests and full-page screenshots are not captured. " +
    "Disable that extension on this site for full capture."
  );
}

async function startRecording(tabId) {
  if (session.recording) return { ok: false, error: "Already recording." };
  const guard = await recordableTabError(tabId);
  if (guard) return { ok: false, error: guard };
  Object.assign(session, {
    recording: true,
    stopping: false,
    tabId,
    startWall: Date.now(),
    monoOffset: null,
    seq: 0,
    events: [],
    rrwebEvents: [],
    requestEvents: new Map(),
    device: null,
    lastErrorShot: 0,
    audioActive: false,
    capture: null,
    lane: null,
  });

  let lane = cdpLane;
  let blockedBy = null;
  try {
    await cdpLane.attach(tabId);
  } catch (err) {
    if (!FOREIGN_EXTENSION_FRAME.test(String(err))) {
      session.recording = false;
      return { ok: false, error: "Could not attach debugger: " + String(err) };
    }
    lane = injectLane;
    blockedBy = await scanForeignFrames(tabId);
  }
  if (!session.recording || session.stopping) {
    // A stop (or tab close) landed while we were attaching; that path has
    // already finalized the session. Don't start a lane on top of it.
    if (lane === cdpLane) await cdpLane.stop(tabId);
    return { ok: false, error: "Recording was stopped before it started." };
  }
  session.capture = lane.name;
  session.lane = lane;
  startKeepAlive();
  const warning = blockedBy ? reducedCaptureWarning(blockedBy) : null;
  if (warning) pushEvent({ t: Date.now(), kind: KIND.LOG, level: "warning", title: warning, detail: { message: warning, blockedBy } });
  await session.lane.start(tabId);

  await session.lane.deviceInfo(tabId);
  await captureScreenshot("Recording started");
  await startReplayRecorder(tabId);
  await startAudioRecorder();
  return warning ? { ok: true, warning, blockedBy } : { ok: true };
}

async function stopRecording() {
  if (!session.recording || session.stopping) return { ok: false, error: "Not recording." };
  session.stopping = true;
  await captureScreenshot("Recording stopped");
  const tabId = session.tabId;

  try {
    await chrome.tabs.sendMessage(tabId, { action: "oj-rrweb-stop" });
  } catch {
    // recorder absent on this page — already logged at start
  }
  // The lane's page-side producer (the probe) must flush BEFORE the grace
  // window too, or its last batch arrives after recording=false and is refused.
  if (session.lane) await session.lane.quiesce(tabId);

  // Give in-flight body fetches and the recorder's final batch a moment to land.
  // recording stays true until after the wait so the final rrweb batch is accepted.
  await new Promise((resolve) => setTimeout(resolve, 400));
  session.recording = false;

  if (session.lane) await session.lane.stop(tabId);

  const audio = await stopAudioRecorder();
  return finalizeRecording({ audio });
}

// The debugger can detach without us asking: the user clicks "Cancel" on
// Chrome's "being debugged" banner, or the recorded tab closes. CDP is already
// gone (so we can't screenshot or detach), but every event captured so far is
// still in the session — salvage it into a report instead of throwing the whole
// recording away (#19). The stopping flag dedupes against a racing stop click or
// a second detach/remove event for the same teardown.
async function salvageRecording(note) {
  if (!session.recording || session.stopping) return;
  session.stopping = true;
  try {
    await chrome.tabs.sendMessage(session.tabId, { action: "oj-rrweb-stop" });
  } catch {
    // recorder absent or tab already gone — nothing left to stop.
  }
  if (session.lane) await session.lane.quiesce(session.tabId);
  // Keep recording=true across the grace window so the recorder's final batch is
  // still accepted, then close the session and persist what we have.
  await new Promise((resolve) => setTimeout(resolve, 400));
  session.recording = false;
  if (session.lane) await session.lane.stop(session.tabId);
  const audio = await stopAudioRecorder();
  await finalizeRecording({ note, audio });
}

// Build the report from the current session and open the viewer. Shared by the
// clean stop path and the salvage path, so an interrupted capture follows the
// exact same persistence (incl. the storage-quota degradation in saveReport).
async function finalizeRecording({ note, audio } = {}) {
  if (note) {
    pushEvent({ t: Date.now(), kind: KIND.LOG, level: "warning", title: note, detail: { message: note } });
  }

  const report = {
    meta: {
      version: chrome.runtime.getManifest().version,
      capturedAt: session.startWall,
      durationMs: Date.now() - session.startWall,
      capture: session.capture,
      pageUrl: session.device && session.device.url,
      pageTitle: session.device && session.device.title,
      eventCount: session.events.length,
    },
    device: session.device,
    events: session.events.slice().sort((a, b) => a.t - b.t),
    // Store rrweb events as a JSON STRING: this is the verified cliff —
    // chrome.storage.local.set's serialization silently nulls JSON nesting
    // deeper than ~100 (DOM depth >= 48), so a plain array would lose deep
    // subtrees on save. The consumers (viewer.js, report-builder.js) normalize
    // string->array up front.
    rrwebEvents: JSON.stringify(session.rrwebEvents.slice().sort((a, b) => a.timestamp - b.timestamp)),
    audio: audio || null,
  };

  const key = "report-" + session.startWall;
  try {
    await saveReport(key, report);
  } finally {
    session.stopping = false;
    stopKeepAlive();
  }
  await chrome.tabs.create({ url: chrome.runtime.getURL("viewer.html?key=" + encodeURIComponent(key)) });
  return { ok: true, eventCount: report.events.length };
}

// Reports carry base64 screenshots and replay events. The manifest requests
// unlimitedStorage, which lifts chrome.storage.local's ~10 MB quota
// (https://developer.chrome.com/docs/extensions/reference/api/storage#storage_areas),
// but keep the layered degradation as a backstop (disk pressure, browsers
// that cap anyway): full report → drop replay → drop screenshot pixels.
async function saveReport(key, report) {
  try {
    const existing = await chrome.storage.local.get(null);
    const stale = Object.keys(existing).filter((k) => k.startsWith("report-") && k !== key);
    if (stale.length) await chrome.storage.local.remove(stale);
  } catch {
    // best effort — fall through to the save attempts
  }
  try {
    await chrome.storage.local.set({ [key]: report, lastReportKey: key });
    return;
  } catch (err) {
    report.rrwebEvents = [];
    report.audio = null;
    report.events.push({
      id: nextId(),
      t: Date.now(),
      rel: Date.now() - session.startWall,
      kind: KIND.LOG,
      level: "warning",
      title: "Session replay omitted: report exceeded storage quota",
      detail: { message: String(err) },
    });
    report.meta.eventCount = report.events.length;
  }
  try {
    await chrome.storage.local.set({ [key]: report, lastReportKey: key });
  } catch {
    report.events = report.events.map((e) =>
      e.kind === KIND.SCREENSHOT ? { ...e, detail: { note: "screenshot dropped (storage quota)" } } : e,
    );
    await chrome.storage.local.set({ [key]: report, lastReportKey: key });
  }
}

// The user detached via the banner (Cancel), or DevTools grabbed the tab: don't
// lose the capture — salvage it. CDP is already gone here.
chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId !== session.tabId) return;
  const why =
    reason === "canceled_by_user"
      ? "debugging was cancelled from the browser banner"
      : reason === "target_closed"
        ? "the recorded tab was closed"
        : "the debugger detached" + (reason ? " (" + reason + ")" : "");
  salvageRecording("Recording ended early: " + why + ". Saved everything captured up to this point.").catch(() => {});
});

// The recorded tab closed: salvage whatever was captured before it went away.
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId !== session.tabId) return;
  salvageRecording("Recording ended early: the recorded tab was closed. Saved everything captured up to this point.").catch(() => {});
});

chrome.debugger.onEvent.addListener((source, method, params) => cdpLane.onDebuggerEvent(source, method, params));

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type) return; // content-script messages are handled by the listener above
  (async () => {
    try {
      switch (msg.action) {
      case "getStatus":
        sendResponse({
          recording: session.recording,
          eventCount: session.events.length,
          tabId: session.tabId,
          capture: session.capture,
        });
        break;
      case "start": {
        // msg.tabId lets automation (e2e, screenshot scripts) target a tab
        // explicitly; the popup omits it and records the active tab.
        let tabId = msg.tabId;
        if (tabId == null) {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          tabId = tab.id;
        }
        sendResponse(await startRecording(tabId));
        break;
      }
      case "stop":
        sendResponse(await stopRecording());
        break;
      case "screenshot":
        await captureScreenshot(msg.label || "Manual screenshot");
        sendResponse({ ok: true, eventCount: session.events.length });
        break;
      default:
        sendResponse({ ok: false, error: "Unknown action" });
      }
    } catch (err) {
      // Never leave the popup awaiting a response that won't come.
      sendResponse({ ok: false, error: String(err) });
    }
  })();
  return true; // async response
});
