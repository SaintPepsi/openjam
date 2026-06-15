// Memory-behavior tests for the MAIN-world recorder (src/rrweb-recorder.js):
// the batch buffer must always drain (flush interval, pagehide, stop), and the
// recorder must start/stop on the relay's commands. The recorder has no
// chrome.* APIs in the main world — it speaks only to the isolated-world relay
// (src/rrweb-relay.js) over window.postMessage.
import { test, expect, mock } from "bun:test";

const FLUSH_WAIT_MS = 650; // recorder flushes every 500ms
const TO_RELAY = "oj-rec-to-relay"; // recorder -> relay
const FROM_RELAY = "oj-relay-to-rec"; // relay -> recorder

let currentEmit = null;
let recordCalls = 0;
let stopCalls = 0;

mock.module("rrweb", () => ({
  record(opts) {
    recordCalls++;
    currentEmit = opts.emit;
    return () => {
      stopCalls++;
    };
  },
}));

const posted = [];
const windowEvents = {};
globalThis.window = {
  addEventListener(name, fn) {
    windowEvents[name] = fn;
  },
  postMessage(msg) {
    posted.push(msg);
  },
};

// Deliver a relay->recorder command to the recorder's message listener.
function fromRelay(kind) {
  windowEvents.message({ source: globalThis.window, data: { __oj: FROM_RELAY, kind } });
}
const batches = () =>
  posted.filter((m) => m.__oj === TO_RELAY && m.kind === "batch").map((m) => m.events);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await import("../src/rrweb-recorder.js");

test("announces readiness on load so the relay can start/resume it", () => {
  expect(posted.some((m) => m.__oj === TO_RELAY && m.kind === "ready")).toBe(true);
});

test("starts on the relay's start command and drains the buffer on the flush interval", async () => {
  fromRelay("start");
  expect(recordCalls).toBe(1);
  currentEmit({ type: 3, timestamp: 1 });
  currentEmit({ type: 3, timestamp: 2 });
  currentEmit({ type: 3, timestamp: 3 });
  expect(batches().length).toBe(0); // buffered, not yet flushed
  await sleep(FLUSH_WAIT_MS);
  expect(batches().length).toBe(1);
  expect(batches()[0].length).toBe(3);
  // empty buffer must not produce empty batches
  await sleep(FLUSH_WAIT_MS);
  expect(batches().length).toBe(1);
});

test("each flush drains the buffer — events are never retained across batches", async () => {
  const before = batches().length;
  currentEmit({ type: 3, timestamp: 4 });
  currentEmit({ type: 3, timestamp: 5 });
  await sleep(FLUSH_WAIT_MS);
  expect(batches().length).toBe(before + 1);
  currentEmit({ type: 3, timestamp: 6 });
  await sleep(FLUSH_WAIT_MS);
  expect(batches().length).toBe(before + 2);
  expect(batches()[before + 1].length).toBe(1);
  expect(batches()[before + 1][0].timestamp).toBe(6);
});

test("stops when the relay sends stop (orphaned recorder / explicit stop) and flushes the tail", () => {
  const before = batches().length;
  currentEmit({ type: 3, timestamp: 7 });
  fromRelay("stop");
  expect(stopCalls).toBe(1);
  expect(batches().length).toBe(before + 1);
  expect(batches()[before][0].timestamp).toBe(7);
});

test("pagehide flushes the partial buffer immediately (no tail loss on navigation)", () => {
  fromRelay("start"); // restart after the stop above
  expect(recordCalls).toBe(2);
  const before = batches().length;
  currentEmit({ type: 3, timestamp: 8 });
  currentEmit({ type: 3, timestamp: 9 });
  windowEvents.pagehide(); // no 500ms wait
  expect(batches().length).toBe(before + 1);
  expect(batches()[before].length).toBe(2);
});
