// Memory-behavior tests for the background session (background.js):
// rrweb batches are accepted only from the recorded tab while recording
// (orphan guard), session state resets between recordings (no cross-session
// leak), stale reports are pruned, and the storage-quota fallback degrades in
// layers (drop replay → drop screenshot pixels) instead of failing the capture.
import { test, expect } from "bun:test";

const store = {};
const tabUrlById = {}; // per-test overrides for chrome.tabs.get(id).url
let storageSetFailures = 0;
const createdTabs = [];
const tabMessages = [];
const runtimeListeners = [];
const debuggerDetachListeners = [];

globalThis.chrome = {
  debugger: {
    attach: async () => {},
    detach: async () => {},
    sendCommand: async (_target, method) => {
      if (method === "Runtime.evaluate") {
        return {
          result: {
            value: JSON.stringify({
              userAgent: "test",
              url: "https://example.test/app",
              title: "Test page",
              viewport: { width: 100, height: 100 },
            }),
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
    get: async (id) => ({ id, url: tabUrlById[id] ?? "https://example.test/app" }),
    sendMessage: async (tabId, msg) => {
      tabMessages.push({ tabId, msg });
      return { ok: true };
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
  scripting: { executeScript: async () => {} },
  runtime: {
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

const batch = (tabId, events) => dispatch({ type: "oj-rrweb-batch", events }, { tab: { id: tabId } });
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
  expect(report.rrwebEvents.length).toBe(2); // tab-2 events never entered the session
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
  expect(report.rrwebEvents.length).toBe(4); // nothing lost
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
  expect(store[firstKey].rrwebEvents.length).toBe(7);

  await dispatch({ action: "start" });
  await dispatch({ action: "stop" }); // no batches this time
  const secondKey = store.lastReportKey;
  expect(secondKey).not.toBe(firstKey);
  expect(store[secondKey].rrwebEvents.length).toBe(0); // previous session's events not retained
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
