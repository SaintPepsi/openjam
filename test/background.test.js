// Memory-behavior tests for the background session (background.js):
// rrweb batches are accepted only from the recorded tab while recording
// (orphan guard), session state resets between recordings (no cross-session
// leak), stale reports are pruned, and the storage-quota fallback degrades in
// layers (drop replay → drop screenshot pixels) instead of failing the capture.
import { test, expect } from "bun:test";

const store = {};
const tabUrlById = {}; // per-test overrides for chrome.tabs.get(id).url
let attachFailure = null; // per-test: chrome.debugger.attach throws this
let frameSrcs = []; // per-test: what the foreign-frame scan finds in the page
let captureVisibleTabCalls = 0;
let storageSetFailures = 0;
const createdTabs = [];
const tabMessages = [];
const runtimeListeners = [];
const debuggerDetachListeners = [];

globalThis.chrome = {
  debugger: {
    attach: async () => {
      if (attachFailure) throw attachFailure;
    },
    detach: async () => {},
    sendCommand: async (_target, method) => {
      if (method === "Runtime.evaluate") {
        // returnByValue: the evaluated object comes back as a value, not a string.
        return {
          result: {
            value: {
              userAgent: "test",
              url: "https://example.test/app",
              title: "Test page",
              viewport: { width: 100, height: 100 },
            },
          },
        };
      }
      if (method === "Page.captureScreenshot") return { data: "QUJD" };
      return {};
    },
    onEvent: { addListener() {} },
    onDetach: {
      addListener(fn) {
        debuggerDetachListeners.push(fn);
      },
    },
  },
  tabs: {
    query: async () => [{ id: 1 }],
    get: async (id) => ({ id, url: tabUrlById[id] ?? "https://example.test/app", active: true, windowId: 1 }),
    sendMessage: async (tabId, msg) => {
      tabMessages.push({ tabId, msg });
      if (msg.action === "oj-device-info") return { userAgent: "probe-ua", url: "https://example.test/app", title: "Test page" };
      return { ok: true };
    },
    captureVisibleTab: async () => {
      captureVisibleTabCalls++;
      return "data:image/png;base64,AA==";
    },
    create: async (opts) => {
      createdTabs.push(opts.url);
    },
    onRemoved: { addListener() {} },
  },
  storage: {
    local: {
      get: async (key) => (key === null ? { ...store } : { [key]: store[key] }),
      set: async (obj) => {
        if (storageSetFailures > 0) {
          storageSetFailures--;
          throw new Error("QUOTA_BYTES quota exceeded");
        }
        Object.assign(store, obj);
      },
      remove: async (keys) => {
        for (const k of [].concat(keys)) delete store[k];
      },
    },
  },
  scripting: {
    executeScript: async (opts) => (opts.func ? [{ result: frameSrcs }] : undefined),
  },
  runtime: {
    id: "own",
    getManifest: () => ({ version: "0.2.0" }),
    getURL: (p) => "chrome-extension://test/" + p,
    onMessage: {
      addListener(fn) {
        runtimeListeners.push(fn);
      },
    },
  },
};

function dispatch(msg, sender = {}) {
  return new Promise((resolve) => {
    let done = false;
    const sendResponse = (r) => {
      if (!done) {
        done = true;
        resolve(r);
      }
    };
    for (const fn of runtimeListeners) fn(msg, sender, sendResponse);
  });
}

// Batches arrive from the relay as a JSON STRING (eventsJson) — stringified at
// the recorder so deep DOM clears Chrome's Mojo ~100-depth cap; background.js
// JSON.parses it back into the in-memory array. Mirror that contract here.
const batch = (tabId, events) =>
  dispatch({ type: "oj-rrweb-batch", eventsJson: JSON.stringify(events) }, { tab: { id: tabId } });
// A finalized report stores rrwebEvents as a JSON string (storage.local is
// Mojo-backed too); parse to inspect. The degraded quota path stays a raw array.
const rrOf = (report) => JSON.parse(report.rrwebEvents);
const makeEvents = (n, t0 = 1000) => Array.from({ length: n }, (_, i) => ({ type: 3, timestamp: t0 + i }));
const storedReports = () => Object.keys(store).filter((k) => k.startsWith("report-"));

await import("../background.js");

test("accepts batches only from the recorded tab; rejects others with {stop:true}", async () => {
  expect((await dispatch({ action: "start" })).ok).toBe(true);
  expect(await batch(1, makeEvents(2))).toEqual({ ok: true });
  expect(await batch(2, makeEvents(50))).toEqual({ stop: true }); // wrong tab — not accumulated
  const res = await dispatch({ action: "stop" });
  expect(res.ok).toBe(true);
  const report = store[store.lastReportKey];
  expect(rrOf(report).length).toBe(2); // tab-2 events never entered the session
  expect(report.audio).toBe(null); // no audioSettings configured → audio lane stays off
});

test("batches after recording ends are refused (orphaned-recorder guard)", async () => {
  expect(await batch(1, makeEvents(5))).toEqual({ stop: true });
});

test("cancelling the debug banner salvages the recording instead of losing it (#19)", async () => {
  expect((await dispatch({ action: "start" })).ok).toBe(true);
  await batch(1, makeEvents(4)); // events captured before the user hits Cancel
  tabMessages.length = 0;
  createdTabs.length = 0;

  // User clicks "Cancel" on Chrome's "being debugged" banner → CDP detaches.
  for (const fn of debuggerDetachListeners) fn({ tabId: 1 }, "canceled_by_user");
  await new Promise((r) => setTimeout(r, 600)); // salvage grace window + save

  expect(tabMessages.some((m) => m.msg.action === "oj-rrweb-stop")).toBe(true); // orphaned recorder told to stop
  const report = store[store.lastReportKey];
  expect(report).toBeDefined();
  expect(rrOf(report).length).toBe(4); // nothing lost
  expect(createdTabs.length).toBe(1); // report opened for the user
  expect(report.events.some((e) => /cancelled from the browser banner/i.test(e.title))).toBe(true);
  expect((await dispatch({ action: "getStatus" })).recording).toBe(false);
  expect(await batch(1, makeEvents(1))).toEqual({ stop: true }); // post-salvage batches refused
});

test("sessions don't leak into each other, and stale reports are pruned from storage", async () => {
  await dispatch({ action: "start" });
  await batch(1, makeEvents(7));
  await dispatch({ action: "stop" });
  const firstKey = store.lastReportKey;
  expect(rrOf(store[firstKey]).length).toBe(7);

  await dispatch({ action: "start" });
  await dispatch({ action: "stop" }); // no batches this time
  const secondKey = store.lastReportKey;
  expect(secondKey).not.toBe(firstKey);
  expect(rrOf(store[secondKey]).length).toBe(0); // previous session's events not retained
  expect(storedReports()).toEqual([secondKey]); // old report removed — storage stays bounded
});

test("storage quota layer 1: replay dropped, capture survives, timeline notes it", async () => {
  await dispatch({ action: "start" });
  await batch(1, makeEvents(100));
  storageSetFailures = 1;
  const res = await dispatch({ action: "stop" });
  expect(res.ok).toBe(true);
  const report = store[store.lastReportKey];
  expect(report.rrwebEvents).toEqual([]);
  const note = report.events.find((e) => e.title.includes("Session replay omitted"));
  expect(note).toBeDefined();
  expect(report.meta.eventCount).toBe(report.events.length); // count updated with the note
});

test("storage quota layer 2: screenshot pixels dropped, capture still survives", async () => {
  await dispatch({ action: "start" });
  await batch(1, makeEvents(100));
  storageSetFailures = 2;
  const res = await dispatch({ action: "stop" });
  expect(res.ok).toBe(true);
  const report = store[store.lastReportKey];
  const screenshots = report.events.filter((e) => e.kind === "screenshot");
  expect(screenshots.length).toBeGreaterThan(0);
  for (const s of screenshots) {
    expect(s.detail.image).toBeUndefined();
    expect(s.detail.note).toContain("storage quota");
  }
});

test("persistent storage failure answers the popup instead of hanging it", async () => {
  await dispatch({ action: "start" });
  storageSetFailures = 99;
  const res = await dispatch({ action: "stop" });
  expect(res.ok).toBe(false);
  expect(String(res.error)).toContain("quota");
  storageSetFailures = 0;
});

test("concurrent stop clicks produce one report and one viewer tab", async () => {
  await dispatch({ action: "start" });
  await batch(1, makeEvents(3));
  createdTabs.length = 0;
  const [r1, r2] = await Promise.all([dispatch({ action: "stop" }), dispatch({ action: "stop" })]);
  expect([r1.ok, r2.ok].sort()).toEqual([false, true]);
  expect(createdTabs.length).toBe(1);
});

test("a foreign extension's iframe switches the session to the inject lane instead of failing (#48)", async () => {
  // The tab URL is a plain https page, so the pre-attach guard passes; Chrome
  // then rejects the attach because another extension owns one of its frames.
  // Disconfirming inputs: (a) change the thrown message to any other CDP error →
  // ok:false and no lane; (b) drop the probe-batch handler → no console event.
  attachFailure = new Error("Cannot access a chrome-extension:// URL of different extension");
  frameSrcs = ["chrome-extension://aaaa/menu.html", "chrome-extension://own/x.html"];
  tabMessages.length = 0;
  const started = await dispatch({ action: "start", tabId: 7 });
  attachFailure = null;
  expect(started.ok).toBe(true);
  expect(started.blockedBy).toEqual(["aaaa"]);
  expect(started.warning).toMatch(/reduced mode: extension aaaa/);
  expect((await dispatch({ action: "getStatus" })).capture).toBe("inject");
  // the lane armed the probe, asked the page for device info, and screenshotted via captureVisibleTab
  expect(tabMessages.map((m) => m.msg.action)).toEqual(expect.arrayContaining(["oj-probe-start", "oj-device-info", "oj-rrweb-start"]));
  expect(captureVisibleTabCalls).toBe(1);
  // a reloaded page asks hello → resume both recorder and probe
  expect(await dispatch({ type: "oj-rrweb-hello" }, { tab: { id: 7 } })).toEqual({ record: true, probe: true });

  // probe records from the recorded tab land on the timeline with the CDP schema
  const now = Date.now(); // report events sort by t; the warning was pushed at start
  const records = [
    { kind: "console", level: "log", t: now + 1, message: "counter is now 1", stack: [] },
    { kind: "net-start", requestId: "f1", t: now + 2, method: "GET", url: "https://example.test/api", resourceType: "fetch", requestHeaders: {}, requestBody: null },
    { kind: "net-end", requestId: "f1", t: now + 10, status: 200, statusText: "OK", mimeType: "application/json", responseHeaders: {}, durationMs: 9, encodedBytes: 2, responseBody: "{}", failed: false },
    { kind: "error", t: now + 20, message: "Error: boom\n    at x", url: "https://example.test/app", line: 1, column: 1 },
  ];
  expect(await dispatch({ type: "oj-page-batch", eventsJson: JSON.stringify(records) }, { tab: { id: 7 } })).toEqual({ ok: true });
  // …but not from another tab
  expect(await dispatch({ type: "oj-page-batch", eventsJson: "[]" }, { tab: { id: 8 } })).toEqual({ stop: true });

  await dispatch({ action: "stop" });
  const report = store[storedReports()[0]];
  expect(report.meta.capture).toBe("inject");
  expect(report.device.userAgent).toBe("probe-ua");
  const kinds = report.events.map((e) => e.kind);
  expect(kinds[0]).toBe("log"); // the reduced-mode warning leads the timeline
  expect(report.events[0].detail.blockedBy).toEqual(["aaaa"]);
  const net = report.events.find((e) => e.kind === "network");
  expect(net.detail).toMatchObject({ method: "GET", status: 200, resourceType: "fetch", responseBody: "{}", durationMs: 9 });
  expect(report.events.find((e) => e.kind === "console").title).toBe("counter is now 1");
  expect(report.events.find((e) => e.kind === "error").title).toBe("Error: boom");
  expect(report.events.filter((e) => e.kind === "screenshot").every((e) => e.detail.image === "data:image/png;base64,AA==")).toBe(true);
  // on the cdp lane, probe batches are refused even from the recorded tab
  frameSrcs = [];
  expect((await dispatch({ action: "start", tabId: 7 })).ok).toBe(true);
  expect(await dispatch({ type: "oj-page-batch", eventsJson: "[]" }, { tab: { id: 7 } })).toEqual({ stop: true });
  await dispatch({ action: "stop" });
});

test("a foreign frame the scan cannot see still records, with an unnamed warning", async () => {
  attachFailure = new Error("Cannot access a chrome-extension:// URL of different extension");
  frameSrcs = [];
  const started = await dispatch({ action: "start", tabId: 7 });
  attachFailure = null;
  expect(started).toMatchObject({ ok: true, blockedBy: [] });
  expect(started.warning).toMatch(/reduced mode: another extension has content/);
  await dispatch({ action: "stop" });
});

test("other attach failures keep the raw CDP error so the issue link carries it", async () => {
  attachFailure = new Error("Another debugger is already attached to the tab with id: 7.");
  const res = await dispatch({ action: "start", tabId: 7 });
  attachFailure = null;
  expect(res.ok).toBe(false);
  expect(res.error).toBe("Could not attach debugger: Error: Another debugger is already attached to the tab with id: 7.");
  expect((await dispatch({ action: "getStatus" })).recording).toBe(false);
});

test("a session records on the cdp lane and the report says so (meta.capture)", async () => {
  // session.capture is THE signal for which lane a recording runs on; every
  // consumer (viewer badge, manifest doc, degraded warning) reads it from meta.
  // Disconfirming: drop the `capture: session.capture` copy in finalizeRecording.
  expect((await dispatch({ action: "start", tabId: 1 })).ok).toBe(true);
  expect((await dispatch({ action: "getStatus" })).capture).toBe("cdp");
  await dispatch({ action: "stop" });
  const report = store[storedReports()[0]];
  expect(report.meta.capture).toBe("cdp");
  expect(report.device.userAgent).toBe("test");
  expect((await dispatch({ action: "getStatus" })).capture).toBe("cdp"); // last lane, until the next start
});

test("refuses non-recordable tabs with actionable advice, not a raw CDP error", async () => {
  // chrome.debugger can't attach to another extension's page; without the guard
  // the worker leaks Chrome's "Cannot access a chrome-extension:// URL of
  // different extension" error and never records.
  tabUrlById[7] = "chrome-extension://aaaabbbbccccdddd/options.html";
  const res = await dispatch({ action: "start", tabId: 7 });
  expect(res.ok).toBe(false);
  expect(res.error).toMatch(/only record normal web pages/);
  expect(res.error).not.toMatch(/debugger|chrome-extension/);
  expect((await dispatch({ action: "getStatus" })).recording).toBe(false);
  delete tabUrlById[7];
});
