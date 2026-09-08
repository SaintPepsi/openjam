// Inject capture lane: recording without chrome.debugger. Console, errors and
// fetch/XHR come from the MAIN-world page probe (src/page-probe.js) through
// the relay; screenshots from chrome.tabs.captureVisibleTab; device info from
// the relay running the shared collector. Same event schema as the CDP lane
// (event-kinds.js LEGEND), with null where this lane cannot know.
import { KIND } from "../../event-kinds.js";

// One probe record -> one timeline event (net-end is a merge, not an event).
export function pageEventToTimeline(ev) {
  switch (ev.kind) {
    case "console":
      return {
        t: ev.t,
        kind: KIND.CONSOLE,
        level: ev.level,
        title: ev.message,
        detail: { message: ev.message, stack: ev.stack || [] },
      };
    case "error":
      return {
        t: ev.t,
        kind: KIND.ERROR,
        level: "error",
        title: String(ev.message || "Uncaught exception").split("\n")[0],
        detail: { message: ev.message, url: ev.url, line: ev.line, column: ev.column, stack: [] },
      };
    case "net-start":
      return {
        t: ev.t,
        kind: KIND.NETWORK,
        title: ev.method + " " + ev.url,
        detail: {
          requestId: ev.requestId,
          method: ev.method,
          url: ev.url,
          resourceType: ev.resourceType,
          requestHeaders: ev.requestHeaders || {},
          requestBody: ev.requestBody ?? null,
          status: null,
          statusText: null,
          mimeType: null,
          responseHeaders: null,
          durationMs: null,
          encodedBytes: null,
          failed: false,
        },
      };
    default:
      return null;
  }
}

// Fold a net-end record into the timeline event its net-start created.
export function mergeNetworkEnd(event, end) {
  const d = event.detail;
  if (end.failed) {
    d.failed = true;
    d.errorText = end.errorText || "failed";
    d.canceled = !!end.canceled;
    event.title = (d.canceled ? "CANCELED " : "FAILED ") + d.url;
  } else {
    d.status = end.status;
    d.statusText = end.statusText;
    d.mimeType = end.mimeType;
    d.responseHeaders = end.responseHeaders || {};
    d.remoteAddress = null;
    d.fromCache = null;
    if (end.responseBody != null) d.responseBody = end.responseBody;
  }
  d.durationMs = end.durationMs ?? null;
  d.encodedBytes = end.encodedBytes ?? null;
  return event;
}

// The probe lives only in the recorded tab, only while this lane records: it
// is injected into the current document at start, and again into each document
// the tab navigates to (the relay's hello → injectProbe). It is never a manifest
// or registered content script — those match by URL, not by tab, and would put
// patched fetch/console into every page the user has open.
const PROBE_FILES = ["dist/page-probe.js"];

export function createInjectLane({ session, pushEvent, maybeErrorScreenshot, ensureContentScripts }) {
  let windowId = null;

  async function tell(tabId, action) {
    try {
      return await chrome.tabs.sendMessage(tabId, { action });
    } catch {
      await ensureContentScripts(tabId);
      return chrome.tabs.sendMessage(tabId, { action });
    }
  }

  // injectImmediately: as early as the API allows in a document that is still
  // loading, so a navigation mid-recording misses as little as possible.
  function injectProbe(tabId) {
    return chrome.scripting.executeScript({ target: { tabId }, files: PROBE_FILES, world: "MAIN", injectImmediately: true });
  }

  return {
    name: "inject",
    injectProbe,
    async start(tabId) {
      try {
        ({ windowId } = await chrome.tabs.get(tabId));
        await injectProbe(tabId);
        await tell(tabId, "oj-probe-start");
      } catch (err) {
        pushEvent({ t: Date.now(), kind: KIND.LOG, level: "warning", title: "Console and network capture unavailable on this page", detail: { message: String(err) } });
      }
    },
    // Before the stop grace window: make the probe flush its buffer while the
    // background still accepts batches.
    async quiesce(tabId) {
      try {
        await chrome.tabs.sendMessage(tabId, { action: "oj-probe-stop" });
      } catch {
        // probe absent or tab gone — nothing to flush
      }
    },
    async stop() {},
    async screenshot(label) {
      try {
        // captureVisibleTab rejects on its own when the tab isn't the visible one.
        const image = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
        pushEvent({ t: Date.now(), kind: KIND.SCREENSHOT, title: label, detail: { image } });
      } catch (err) {
        pushEvent({ t: Date.now(), kind: KIND.SCREENSHOT, title: label + " (failed)", detail: { error: String(err) } });
      }
    },
    async deviceInfo(tabId) {
      try {
        const info = await tell(tabId, "oj-device-info");
        if (!info || typeof info !== "object") throw new Error("no device info from page");
        session.device = info;
      } catch (err) {
        session.device = { error: String(err) };
      }
    },
    handleBatch(records) {
      for (const rec of records) {
        if (rec.kind === "net-end") {
          const event = session.requestEvents.get(rec.requestId);
          if (event) mergeNetworkEnd(event, rec);
          continue;
        }
        const ev = pageEventToTimeline(rec);
        if (!ev) continue;
        const full = pushEvent(ev);
        if (rec.kind === "net-start") session.requestEvents.set(rec.requestId, full);
        if (rec.kind === "error" || (rec.kind === "console" && rec.level === "error")) maybeErrorScreenshot();
      }
    },
  };
}
