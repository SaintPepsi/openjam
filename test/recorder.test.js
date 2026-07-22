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
let capturedOpts = null;
let recordCalls = 0;
let stopCalls = 0;

mock.module("rrweb", () => ({
  record(opts) {
    recordCalls++;
    capturedOpts = opts;
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

// bun's test env has fetch + URL.createObjectURL (so blob: URLs resolve) but no
// FileReader, which the recorder's blob->data rewrite needs. Polyfill just that
// missing global with a Blob-backed readAsDataURL, keeping fetch and the object
// URL real — so the rewrite path (emit -> fetch(blob:) -> data: -> flush) runs
// end-to-end, exactly as it does in the MAIN world.
globalThis.FileReader = class {
  readAsDataURL(blob) {
    blob
      .arrayBuffer()
      .then((buf) => {
        this.result = `data:${blob.type || "application/octet-stream"};base64,${Buffer.from(buf).toString("base64")}`;
        this.onload && this.onload();
      })
      .catch((err) => this.onerror && this.onerror(err));
  }
};

// Deliver a relay->recorder command to the recorder's message listener.
function fromRelay(kind) {
  windowEvents.message({ source: globalThis.window, data: { __oj: FROM_RELAY, kind } });
}
// Batches now cross to the relay as a JSON STRING (eventsJson), not a raw array:
// the recorder stringifies at the source so deep DOM survives Chrome's Mojo
// ~100-depth cap on the relay's chrome.runtime.sendMessage hop. Parse it back so
// every assertion below tests the exact same event shapes as before.
const batches = () =>
  posted.filter((m) => m.__oj === TO_RELAY && m.kind === "batch").map((m) => JSON.parse(m.eventsJson));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await import("../src/rrweb-recorder.js");

test("announces readiness on load so the relay can start/resume it", () => {
  expect(posted.some((m) => m.__oj === TO_RELAY && m.kind === "ready")).toBe(true);
});

test("starts on the relay's start command and drains the buffer on the flush interval", async () => {
  fromRelay("start");
  expect(recordCalls).toBe(1);
  // AC2 causal guard: the fix is exactly this flag. Disconfirming input —
  // set inlineImages:false (or remove it) in src/rrweb-recorder.js and this
  // goes red under `bun test`. This is the source-level durable proof (the
  // e2e acceptance test is the in-CI end-to-end lever since CI builds from
  // source; the e2e negative is a one-time manual confirmation).
  expect(capturedOpts.inlineImages).toBe(true);
  // Issue #44 causal guard: exported reports were 87.6 MB, almost entirely
  // lossless-PNG inlineImages. Disconfirming input — drop dataURLOptions (or
  // change the type/quality) in src/rrweb-recorder.js and this goes red.
  expect(capturedOpts.dataURLOptions).toEqual({ type: "image/webp", quality: 0.6 });
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

test("rewrites a mid-recording blob: <img> src to a data: URI before the batch flushes", async () => {
  // The real-world case (Atlassian Media): an <img> already in the snapshot gets
  // its src set to a blob: URL mid-recording, which rrweb records verbatim as a
  // type-3 attribute mutation. The recorder must resolve that blob: into a data:
  // URI inside the buffered event before it posts, so the export renders offline.
  //
  // Disconfirming input: delete the `rewriteBlobImages(event)` call from the emit
  // handler in src/rrweb-recorder.js and this goes red — the posted src stays blob:.
  const before = batches().length;
  const blobUrl = URL.createObjectURL(new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }));
  expect(blobUrl.startsWith("blob:")).toBe(true);

  // type 3 (incremental), source 0 (mutation), an attributes entry setting src=blob:
  currentEmit({
    type: 3,
    timestamp: 10,
    data: { source: 0, attributes: [{ id: 1, attributes: { src: blobUrl } }] },
  });
  await sleep(FLUSH_WAIT_MS + 200); // flush timer (500ms) + the async rewrite

  expect(batches().length).toBe(before + 1);
  const src = batches()[before][0].data.attributes[0].attributes.src;
  expect(src.startsWith("data:")).toBe(true); // no dead blob: left in the flushed event
});

test("rewrites a blob: <img> src inside a type-2 full-snapshot node tree", async () => {
  // The full-snapshot entry point: a fresh page load (or the recorder's own
  // initial snapshot) can already contain an <img> whose src is a blob: URL,
  // with no rr_dataURL (inlineImages only stamps that onto imgs it could
  // itself draw to canvas at snapshot time — a not-yet-loaded or
  // cross-origin-tainted img can still reach here bare).
  //
  // Disconfirming input: remove the `event.type === 2 && data.node` branch
  // from collectBlobTargets in src/rrweb-recorder.js and this goes red — the
  // posted src stays blob:.
  const before = batches().length;
  const blobUrl = URL.createObjectURL(new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" }));

  currentEmit({
    type: 2,
    timestamp: 20,
    data: {
      node: {
        tagName: "html",
        childNodes: [{ tagName: "img", attributes: { src: blobUrl }, childNodes: [] }],
      },
    },
  });
  await sleep(FLUSH_WAIT_MS + 200);

  expect(batches().length).toBe(before + 1);
  const src = batches()[before][0].data.node.childNodes[0].attributes.src;
  expect(src.startsWith("data:")).toBe(true);
});

test("rewrites a blob: <img> src inside a type-3 source-0 adds subtree", async () => {
  // The mutation-add entry point: a subtree inserted mid-recording (data.adds)
  // can bring in a new <img> with a blob: src, distinct from both the
  // full-snapshot path and the attribute-mutation path already covered above.
  //
  // Disconfirming input: remove the `data.adds` loop from collectBlobTargets
  // in src/rrweb-recorder.js and this goes red — the posted src stays blob:.
  const before = batches().length;
  const blobUrl = URL.createObjectURL(new Blob([new Uint8Array([5, 6, 7, 8])], { type: "image/png" }));

  currentEmit({
    type: 3,
    timestamp: 30,
    data: {
      source: 0,
      adds: [{ parentId: 1, node: { tagName: "img", attributes: { src: blobUrl }, childNodes: [] } }],
    },
  });
  await sleep(FLUSH_WAIT_MS + 200);

  expect(batches().length).toBe(before + 1);
  const src = batches()[before][0].data.adds[0].node.attributes.src;
  expect(src.startsWith("data:")).toBe(true);
});

test("leaves a blob: <img> src untouched when rr_dataURL is already present (skip branch)", async () => {
  // inlineImages already resolved this img at record time (rr_dataURL set) —
  // rewriteBlobImages must not touch it, so the original blob: src (now inert,
  // rr_dataURL is what replay actually uses) survives unchanged.
  const before = batches().length;
  const blobUrl = URL.createObjectURL(new Blob([new Uint8Array([9, 9, 9, 9])], { type: "image/png" }));

  currentEmit({
    type: 2,
    timestamp: 40,
    data: {
      node: {
        tagName: "html",
        childNodes: [
          { tagName: "img", attributes: { src: blobUrl, rr_dataURL: "data:image/png;base64,alreadydone" }, childNodes: [] },
        ],
      },
    },
  });
  await sleep(FLUSH_WAIT_MS + 200);

  expect(batches().length).toBe(before + 1);
  const attrs = batches()[before][0].data.node.childNodes[0].attributes;
  expect(attrs.src).toBe(blobUrl); // untouched — still the original blob: URL
  expect(attrs.rr_dataURL).toBe("data:image/png;base64,alreadydone");
});
