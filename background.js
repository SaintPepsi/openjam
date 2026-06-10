// OpenJam capture engine.
// Attaches the Chrome DevTools Protocol to the active tab and records console
// logs, network requests, JS errors and screenshots onto one wall-clock timeline.

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
      kind: "screenshot",
      title: label,
      detail: { image: "data:image/png;base64," + result.data },
    });
  } catch (err) {
    pushEvent({ t: Date.now(), kind: "screenshot", title: label + " (failed)", detail: { error: String(err) } });
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
        kind: "network",
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
        kind: "console",
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
        kind: "error",
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
        kind: "log",
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
    // Content script absent (e.g. extension was reloaded after the page
    // loaded, or a restricted page). Inject and retry once.
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["dist/rrweb-recorder.js"] });
      await chrome.tabs.sendMessage(tabId, { action: "oj-rrweb-start" });
    } catch (err) {
      pushEvent({
        t: Date.now(),
        kind: "log",
        level: "warning",
        title: "Session replay unavailable on this page",
        detail: { message: String(err) },
      });
    }
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

async function startRecording(tabId) {
  if (session.recording) return { ok: false, error: "Already recording." };
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

// Reports carry base64 screenshots and replay events, and chrome.storage.local
// is capped at ~10 MB (https://developer.chrome.com/docs/extensions/reference/api/storage).
// Keep only the newest report, and degrade in layers rather than failing the
// capture: full report → drop replay → drop screenshot pixels.
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
    report.events.push({
      id: nextId(),
      t: Date.now(),
      rel: Date.now() - session.startWall,
      kind: "log",
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
      e.kind === "screenshot" ? { ...e, detail: { note: "screenshot dropped (storage quota)" } } : e,
    );
    await chrome.storage.local.set({ [key]: report, lastReportKey: key });
  }
}

// If the debugged tab closes or the user detaches via the banner, stop cleanly —
// including the rrweb recorder, which otherwise keeps serializing the page.
chrome.debugger.onDetach.addListener((source) => {
  if (session.recording && source.tabId === session.tabId) {
    session.recording = false;
    chrome.tabs.sendMessage(source.tabId, { action: "oj-rrweb-stop" }).catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (session.recording && tabId === session.tabId) {
    session.recording = false;
  }
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
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        sendResponse(await startRecording(tab.id));
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
