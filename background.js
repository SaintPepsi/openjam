// OpenJam capture engine.
// Attaches the Chrome DevTools Protocol to the active tab and records console
// logs, network requests, JS errors and screenshots onto one wall-clock timeline.

import { KIND } from "./event-kinds.js";

const PROTOCOL_VERSION = "1.3";
const BODY_CAPTURE_MAX_BYTES = 100 * 1024; // skip large/binary response bodies
const SCREENSHOT_ON_ERROR_COOLDOWN_MS = 2000;

const session = {
  recording: false,
  stopping: false, // guards re-entrant stopRecording during the grace window
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

function sendCmd(method, params = {}) {
  return chrome.debugger.sendCommand({ tabId: session.tabId }, method, params);
}

function monotonicToWall(timestampSeconds) {
  if (session.monoOffset === null) return Date.now();
  return timestampSeconds * 1000 + session.monoOffset;
}

// ---- argument / preview formatting ---------------------------------------

function previewToString(preview) {
  const props = (preview.properties || []).map((p) =>
    preview.subtype === "array" ? p.value : p.name + ": " + p.value,
  );
  const body = props.join(", ") + (preview.overflow ? ", …" : "");
  if (preview.subtype === "array") return "[" + body + "]";
  const label = preview.description && preview.description !== "Object" ? preview.description + " " : "";
  return label + "{" + body + "}";
}

function formatRemoteObject(obj) {
  if (!obj) return "";
  switch (obj.type) {
    case "string":
      return obj.value;
    case "number":
    case "boolean":
      return String(obj.value);
    case "undefined":
      return "undefined";
    case "function":
      return obj.description || "function";
    case "object":
      if (obj.subtype === "null") return "null";
      if (obj.preview) return previewToString(obj.preview);
      return obj.description || "[object]";
    default:
      return obj.description != null ? obj.description : String(obj.value);
  }
}

function formatStackTrace(stackTrace) {
  if (!stackTrace || !stackTrace.callFrames) return [];
  return stackTrace.callFrames.map((f) => {
    const where = (f.url || "<anonymous>") + ":" + (f.lineNumber + 1) + ":" + (f.columnNumber + 1);
    const name = f.functionName || "(anonymous)";
    return name + " — " + where;
  });
}

function headersToObject(headers) {
  return headers || {};
}

// ---- capture helpers ------------------------------------------------------

async function captureDeviceInfo() {
  const expression = `JSON.stringify({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    languages: navigator.languages,
    vendor: navigator.vendor,
    cookieEnabled: navigator.cookieEnabled,
    online: navigator.onLine,
    url: location.href,
    referrer: document.referrer,
    title: document.title,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    screen: { width: screen.width, height: screen.height, dpr: window.devicePixelRatio, colorDepth: screen.colorDepth },
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    memory: (performance.memory ? { usedJSHeapSize: performance.memory.usedJSHeapSize, totalJSHeapSize: performance.memory.totalJSHeapSize, jsHeapSizeLimit: performance.memory.jsHeapSizeLimit } : null)
  })`;
  try {
    const result = await sendCmd("Runtime.evaluate", { expression, returnByValue: true });
    session.device = JSON.parse(result.result.value);
  } catch (err) {
    session.device = { error: String(err) };
  }
}

async function captureScreenshot(label) {
  try {
    const result = await sendCmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    pushEvent({
      t: Date.now(),
      kind: KIND.SCREENSHOT,
      title: label,
      detail: { image: "data:image/png;base64," + result.data },
    });
  } catch (err) {
    pushEvent({ t: Date.now(), kind: KIND.SCREENSHOT, title: label + " (failed)", detail: { error: String(err) } });
  }
}

async function fetchResponseBody(requestId, event, response) {
  const lengthHeader = Number(headersToObject(response.headers)["content-length"] || headersToObject(response.headers)["Content-Length"] || 0);
  const mime = response.mimeType || "";
  const texty = /json|text|javascript|xml|html|csv|x-www-form-urlencoded/i.test(mime);
  if (!texty || (lengthHeader && lengthHeader > BODY_CAPTURE_MAX_BYTES)) return;
  try {
    const body = await sendCmd("Network.getResponseBody", { requestId });
    if (body.base64Encoded) {
      event.detail.responseBody = "[binary " + (body.body ? body.body.length : 0) + " base64 chars — not decoded]";
    } else if (body.body && body.body.length <= BODY_CAPTURE_MAX_BYTES) {
      event.detail.responseBody = body.body;
    }
  } catch {
    // body may already be evicted from the network cache — ignore.
  }
}

// ---- CDP event routing ----------------------------------------------------

function onDebuggerEvent(source, method, params) {
  if (!session.recording || source.tabId !== session.tabId) return;

  switch (method) {
    case "Network.requestWillBeSent": {
      if (session.monoOffset === null && params.wallTime != null) {
        session.monoOffset = params.wallTime * 1000 - params.timestamp * 1000;
      }
      const t = params.wallTime != null ? params.wallTime * 1000 : monotonicToWall(params.timestamp);
      const req = params.request;
      const event = pushEvent({
        t,
        kind: KIND.NETWORK,
        title: req.method + " " + req.url,
        detail: {
          requestId: params.requestId,
          method: req.method,
          url: req.url,
          resourceType: params.type,
          requestHeaders: headersToObject(req.headers),
          requestBody: req.postData || null,
          monoStart: params.timestamp,
          status: null,
          statusText: null,
          mimeType: null,
          responseHeaders: null,
          durationMs: null,
          encodedBytes: null,
          failed: false,
        },
      });
      session.requestEvents.set(params.requestId, event);
      break;
    }
    case "Network.responseReceived": {
      const event = session.requestEvents.get(params.requestId);
      if (!event) break;
      const r = params.response;
      event.detail.status = r.status;
      event.detail.statusText = r.statusText;
      event.detail.mimeType = r.mimeType;
      event.detail.responseHeaders = headersToObject(r.headers);
      event.detail.remoteAddress = r.remoteIPAddress ? r.remoteIPAddress + ":" + r.remotePort : null;
      event.detail.fromCache = !!r.fromDiskCache;
      break;
    }
    case "Network.loadingFinished": {
      const event = session.requestEvents.get(params.requestId);
      if (!event) break;
      event.detail.encodedBytes = params.encodedDataLength;
      if (event.detail.monoStart != null) {
        event.detail.durationMs = Math.round((params.timestamp - event.detail.monoStart) * 1000);
      }
      const r = { headers: event.detail.responseHeaders, mimeType: event.detail.mimeType };
      fetchResponseBody(params.requestId, event, r);
      break;
    }
    case "Network.loadingFailed": {
      const event = session.requestEvents.get(params.requestId);
      if (!event) break;
      event.detail.failed = true;
      event.detail.errorText = params.errorText;
      event.detail.canceled = !!params.canceled;
      event.title = "FAILED " + event.detail.url;
      break;
    }
    case "Runtime.consoleAPICalled": {
      const text = (params.args || []).map(formatRemoteObject).join(" ");
      pushEvent({
        t: params.timestamp || Date.now(),
        kind: KIND.CONSOLE,
        level: params.type, // log, info, warning, error, debug
        title: text,
        detail: { message: text, stack: formatStackTrace(params.stackTrace) },
      });
      if (params.type === "error") maybeErrorScreenshot();
      break;
    }
    case "Runtime.exceptionThrown": {
      const d = params.exceptionDetails || {};
      const text = (d.exception && d.exception.description) || d.text || "Uncaught exception";
      pushEvent({
        t: params.timestamp || Date.now(),
        kind: KIND.ERROR,
        level: "error",
        title: text.split("\n")[0],
        detail: {
          message: text,
          url: d.url,
          line: d.lineNumber != null ? d.lineNumber + 1 : null,
          column: d.columnNumber != null ? d.columnNumber + 1 : null,
          stack: formatStackTrace(d.stackTrace),
        },
      });
      maybeErrorScreenshot();
      break;
    }
    case "Log.entryAdded": {
      const e = params.entry;
      if (e.source === "network" || e.level === "verbose") break; // network errors already captured
      pushEvent({
        t: e.timestamp || Date.now(),
        kind: KIND.LOG,
        level: e.level,
        title: e.text,
        detail: { message: e.text, url: e.url, source: e.source },
      });
      break;
    }
    default:
      break;
  }
}

function maybeErrorScreenshot() {
  const now = Date.now();
  if (now - session.lastErrorShot < SCREENSHOT_ON_ERROR_COOLDOWN_MS) return;
  session.lastErrorShot = now;
  captureScreenshot("Auto-captured on error");
}

// ---- rrweb replay recorder ------------------------------------------------

async function startReplayRecorder(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { action: "oj-rrweb-start" });
  } catch {
    // Content scripts absent (e.g. extension was reloaded after the page
    // loaded, or a restricted page). Inject both halves and retry once: the
    // rrweb recorder into the MAIN world (so its CSS observers patch the page's
    // own stylesheet APIs) and the relay into the isolated world (for chrome.*).
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["dist/rrweb-recorder.js"], world: "MAIN" });
      await chrome.scripting.executeScript({ target: { tabId }, files: ["dist/rrweb-relay.js"] });
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
    if (accept) session.rrwebEvents.push(...msg.events);
    // {stop:true} tells an orphaned recorder (session ended without it being
    // told, e.g. debug banner dismissed) to stop serializing the page.
    sendResponse(accept ? { ok: true } : { stop: true });
    return;
  }
  if (msg.type === "oj-rrweb-hello") {
    // A page (re)loaded; tell its recorder to resume if we're mid-recording.
    sendResponse({ record: session.recording && sender.tab && sender.tab.id === session.tabId });
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
  });

  try {
    await chrome.debugger.attach({ tabId }, PROTOCOL_VERSION);
  } catch (err) {
    session.recording = false;
    return { ok: false, error: "Could not attach debugger: " + String(err) };
  }

  await sendCmd("Network.enable", {});
  await sendCmd("Runtime.enable", {});
  await sendCmd("Log.enable", {});
  await sendCmd("Page.enable", {});

  await captureDeviceInfo();
  await captureScreenshot("Recording started");
  await startReplayRecorder(tabId);
  await startAudioRecorder();
  return { ok: true };
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

  // Give in-flight body fetches and the recorder's final batch a moment to land.
  // recording stays true until after the wait so the final rrweb batch is accepted.
  await new Promise((resolve) => setTimeout(resolve, 400));
  session.recording = false;

  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    // already detached — fine.
  }

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
  // Keep recording=true across the grace window so the recorder's final batch is
  // still accepted, then close the session and persist what we have.
  await new Promise((resolve) => setTimeout(resolve, 400));
  session.recording = false;
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
      pageUrl: session.device && session.device.url,
      pageTitle: session.device && session.device.title,
      eventCount: session.events.length,
    },
    device: session.device,
    events: session.events.slice().sort((a, b) => a.t - b.t),
    rrwebEvents: session.rrwebEvents.slice().sort((a, b) => a.timestamp - b.timestamp),
    audio: audio || null,
  };

  const key = "report-" + session.startWall;
  try {
    await saveReport(key, report);
  } finally {
    session.stopping = false;
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

chrome.debugger.onEvent.addListener(onDebuggerEvent);

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
