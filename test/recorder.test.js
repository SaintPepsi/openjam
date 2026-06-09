// Memory-behavior tests for the content-script recorder (src/rrweb-recorder.js):
// the batch buffer must always drain (flush interval, pagehide, stop), never
// retain events after a failed send, and stop recording when the background
// answers {stop:true} (orphaned-recorder guard).
import { test, expect, mock } from "bun:test";

const FLUSH_WAIT_MS = 650; // recorder flushes every 500ms

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

const env = { batchResponse: { ok: true }, helloResponse: { record: true }, throwOnSend: false };
const sentBatches = [];
const messageListeners = [];
const windowEvents = {};

globalThis.window = {
  addEventListener(name, fn) {
    windowEvents[name] = fn;
  },
};
globalThis.chrome = {
  runtime: {
    lastError: undefined,
    sendMessage(msg, cb) {
      if (msg.type === "oj-rrweb-hello") {
        if (cb) cb(env.helloResponse);
        return;
      }
      if (env.throwOnSend) throw new Error("Extension context invalidated");
      sentBatches.push(msg.events);
      if (cb) cb(env.batchResponse);
    },
    onMessage: {
      addListener(fn) {
        messageListeners.push(fn);
      },
    },
  },
};

function dispatch(msg) {
  for (const fn of messageListeners) fn(msg, {}, () => {});
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await import("../src/rrweb-recorder.js");

test("starts on hello and drains the buffer on the flush interval", async () => {
  expect(recordCalls).toBe(1);
  currentEmit({ type: 3, timestamp: 1 });
  currentEmit({ type: 3, timestamp: 2 });
  currentEmit({ type: 3, timestamp: 3 });
  expect(sentBatches.length).toBe(0); // buffered, not yet flushed
  await sleep(FLUSH_WAIT_MS);
  expect(sentBatches.length).toBe(1);
  expect(sentBatches[0].length).toBe(3);
  // empty buffer must not produce empty batches
  await sleep(FLUSH_WAIT_MS);
  expect(sentBatches.length).toBe(1);
});

test("buffer does not grow when sendMessage throws — events are dropped, not retained", async () => {
  env.throwOnSend = true;
  currentEmit({ type: 3, timestamp: 4 });
  currentEmit({ type: 3, timestamp: 5 });
  await sleep(FLUSH_WAIT_MS);
  expect(sentBatches.length).toBe(1); // nothing arrived
  env.throwOnSend = false;
  currentEmit({ type: 3, timestamp: 6 });
  await sleep(FLUSH_WAIT_MS);
  // only the new event ships; the two failed ones were not re-buffered
  expect(sentBatches.length).toBe(2);
  expect(sentBatches[1].length).toBe(1);
  expect(sentBatches[1][0].timestamp).toBe(6);
});

test("stops recording when the background answers {stop:true} (orphaned recorder)", async () => {
  env.batchResponse = { stop: true };
  currentEmit({ type: 3, timestamp: 7 });
  await sleep(FLUSH_WAIT_MS);
  expect(stopCalls).toBe(1);
  env.batchResponse = { ok: true };
});

test("pagehide flushes the partial buffer immediately (no tail loss on navigation)", async () => {
  dispatch({ action: "oj-rrweb-start" }); // restart after the orphan stop
  expect(recordCalls).toBe(2);
  const before = sentBatches.length;
  currentEmit({ type: 3, timestamp: 8 });
  currentEmit({ type: 3, timestamp: 9 });
  windowEvents.pagehide(); // no 500ms wait
  expect(sentBatches.length).toBe(before + 1);
  expect(sentBatches[sentBatches.length - 1].length).toBe(2);
});

test("explicit stop flushes remaining events and halts the recorder", async () => {
  const before = sentBatches.length;
  currentEmit({ type: 3, timestamp: 10 });
  dispatch({ action: "oj-rrweb-stop" });
  expect(stopCalls).toBe(2);
  expect(sentBatches.length).toBe(before + 1);
  expect(sentBatches[sentBatches.length - 1][0].timestamp).toBe(10);
});
