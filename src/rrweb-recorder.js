// rrweb session recorder — runs in the page's MAIN world (manifest sets
// "world":"MAIN") so rrweb can patch the page's own CSSStyleSheet.prototype
// .insertRule / .deleteRule and the adoptedStyleSheets setters. An
// isolated-world content script patches a *different* copy of those prototypes,
// so CSS-in-JS frameworks (Emotion/Chakra, styled-components, MUI, …) that
// inject rules at runtime would record with their styles missing and replay
// unstyled. The MAIN world has no chrome.* APIs, so this script talks to the
// isolated-world relay (src/rrweb-relay.js) over window.postMessage; the relay
// bridges to the background worker. Bundled by build.mjs into
// dist/rrweb-recorder.js, injected at document_start so the patch is installed
// before the page's framework runs.
import { record } from "rrweb";

const FLUSH_INTERVAL_MS = 500;
// Hard cap on awaiting blob->data rewrites per flush. Must stay under the background's
// 400ms stop-grace window (background.js stop/salvage paths' setTimeout(resolve, 400)
// before session.recording = false) or the recorder's final awaited flush posts after
// recording is already false and the whole last batch gets silently dropped. 300ms is
// still generous for an in-memory blob fetch + FileReader (typically single-digit ms).
const REWRITE_TIMEOUT_MS = 300;
const TO_RELAY = "oj-rec-to-relay"; // envelope tag for messages we send
const FROM_RELAY = "oj-relay-to-rec"; // envelope tag for messages we receive

// Emit-side blob: -> data: rewriter (WHY):
// inlineImages (below) only runs in rrweb's node serializer — full snapshot and
// mutation-*added* nodes. A src set MID-recording via attribute mutation (the
// real-world Atlassian Media pattern) is recorded verbatim (rrweb.js "attributes"
// case), and rrweb's late-load path writes rr_dataURL onto the snapshot object we
// have already structured-cloned away over postMessage, so it's lost. blob: URLs
// are dead outside the origin tab, so such an <img> replays broken in a
// standalone export. Only the recorder (MAIN world) can still fetch the page's
// live blob: URLs, so it resolves them into data: URIs inside the buffered events
// before flush. The fetch is same-document and in-memory (no network egress —
// stays local-only). Out of scope (noted, not built): blob: in srcset, and CSS
// background-image: url(blob:).

// Per-URL cache: blobUrl -> Promise<dataURL | null>. Dedupes repeated sets of the
// same blob URL and never rejects unhandled (resolves null on any failure).
const blobDataURLCache = new Map();

function blobUrlToDataURL(url) {
  let p = blobDataURLCache.get(url);
  if (p) return p;
  p = fetch(url)
    .then((r) => r.blob())
    .then(
      (blob) =>
        new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        }),
    )
    .catch(() => null);
  blobDataURLCache.set(url, p);
  return p;
}

const isBlobSrc = (v) => typeof v === "string" && v.startsWith("blob:");

// Collect { obj, key } handles for every blob: <img> src in a serialized node
// tree (type 2 snapshot, or a type 3 added subtree). Skips imgs that already
// carry rr_dataURL (inlineImages handled them).
function collectFromNode(node, out) {
  if (!node || typeof node !== "object") return;
  const attrs = node.attributes;
  if (node.tagName === "img" && attrs && isBlobSrc(attrs.src) && !("rr_dataURL" in attrs)) {
    out.push({ obj: attrs, key: "src" });
  }
  const kids = node.childNodes;
  if (Array.isArray(kids)) for (const child of kids) collectFromNode(child, out);
}

// Every blob: img src in one buffered event, across the three entry points a
// mid-recording blob src can travel through.
function collectBlobTargets(event) {
  const out = [];
  const data = event && event.data;
  if (!data) return out;
  if (event.type === 2 && data.node) {
    collectFromNode(data.node, out); // full snapshot
  } else if (event.type === 3 && data.source === 0) {
    if (Array.isArray(data.adds)) for (const add of data.adds) collectFromNode(add.node, out);
    if (Array.isArray(data.attributes)) {
      for (const mut of data.attributes) {
        if (mut && mut.attributes && isBlobSrc(mut.attributes.src)) {
          out.push({ obj: mut.attributes, key: "src" });
        }
      }
    }
  }
  return out;
}

function main() {
  let stopFn = null;
  let buffer = [];
  let flushTimer = null;
  let pending = []; // in-flight blob->data rewrites for the not-yet-flushed buffer

  function post(kind, extra) {
    window.postMessage({ __oj: TO_RELAY, kind, ...extra }, "*");
  }

  // Scan a just-buffered event and kick off (or reuse a cached) conversion for
  // each blob: img src; on resolve, replace the src value in place, mutating the
  // still-buffered event before it flushes.
  function rewriteBlobImages(event) {
    for (const target of collectBlobTargets(event)) {
      const url = target.obj[target.key];
      pending.push(
        blobUrlToDataURL(url).then((dataURL) => {
          if (dataURL && target.obj[target.key] === url) target.obj[target.key] = dataURL;
        }),
      );
    }
  }

  async function flush() {
    if (!buffer.length) return;
    const events = buffer;
    buffer = []; // drain before posting so a failed transport never re-buffers
    const waiting = pending;
    pending = [];
    // Let in-flight rewrites land (blob is in-memory, resolves in ms) so blob:
    // srcs post as data:, but never stall the stream: cap the wait. On
    // timeout/failure the original src is left untouched (graceful — pre-fix
    // behavior). When nothing is pending this stays fully synchronous.
    if (waiting.length) {
      await Promise.race([
        Promise.allSettled(waiting),
        new Promise((resolve) => setTimeout(resolve, REWRITE_TIMEOUT_MS)),
      ]);
    }
    // Carry the batch as a JSON string (WHY): the verified cliff is
    // chrome.storage.local.set, whose serialization silently nulls JSON nesting
    // deeper than ~100 (DOM depth >= 48) when the events are eventually saved.
    // Events therefore travel and persist as a JSON string end to end;
    // stringifying at this hop too is defense-in-depth (messaging itself
    // survived the depth in isolation testing — one contract everywhere keeps
    // the pipeline immune to future serialization changes).
    post("batch", { eventsJson: JSON.stringify(events) });
  }

  // Synchronous drain, shared by pagehide and stop: neither can await the
  // in-flight rewrites (pagehide because the page is unloading; stop because
  // posting must land inside the background's 400ms stop-grace) — post
  // whatever we have immediately (best-effort, as before). Any rewrite still
  // in flight just keeps its original blob: src for that one image; the
  // events themselves are never at risk of being dropped.
  function flushSync() {
    if (!buffer.length) return;
    const events = buffer;
    buffer = [];
    pending = [];
    // Same storage-serialization cliff as flush(): stringify so deep DOM
    // survives end to end (see flush() above for the verified mechanism).
    post("batch", { eventsJson: JSON.stringify(events) });
  }

  function start() {
    if (stopFn) return;
    // blobDataURLCache is module-level state that lives for the page's whole
    // lifetime (guarded by __ojRecorderLoaded below), not just one recording
    // session — clear it here too so a stale entry from a previous session
    // never masks a blob: URL reused for different bytes.
    blobDataURLCache.clear();
    // Inline image bytes as data: URIs at record time. blob: srcs are dead
    // outside the origin tab, so a standalone export renders them broken;
    // inlineImages draws each already-loaded image to an offscreen canvas and
    // stores the pixels as rr_dataURL (no re-fetch for blob:/same-origin, the
    // ticket's case — stays local-only). For cross-origin <img> srcs that
    // taint the canvas, rrweb retries once by re-requesting the same URL the
    // page already loaded with crossOrigin="anonymous" (no new destination,
    // not new egress), then falls back to the untouched src with a
    // console.warn if the server still has no CORS headers.
    // inlineImages draws to canvas then re-encodes; without dataURLOptions that
    // defaults to lossless PNG, which on image-heavy pages (product photos,
    // posters, banners) is the dominant contributor to export size — a real
    // report from issue #44 was 87.6 MB, almost entirely inlined PNGs. webp at
    // 0.6 (REPLAY_DESIGN.md §4) is lossy but photographic content tolerates it
    // fine and the size win is large; unlimitedStorage still covers the
    // IndexedDB budget regardless.
    stopFn = record({
      inlineImages: true,
      dataURLOptions: { type: "image/webp", quality: 0.6 },
      emit(event) {
        buffer.push(event);
        rewriteBlobImages(event); // resolve any blob: img srcs before this batch flushes
        if (!flushTimer) {
          flushTimer = setTimeout(() => {
            flushTimer = null;
            flush();
          }, FLUSH_INTERVAL_MS);
        }
      },
    });
  }

  function stop() {
    if (stopFn) {
      stopFn();
      stopFn = null;
    }
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    // flushSync, not flush: flush() only WAITS for in-flight rewrites, it
    // doesn't apply them (each rewrite mutates its event in place when its
    // own promise resolves). Posting immediately guarantees the final batch
    // always lands inside the background's 400ms stop-grace — zero
    // batch-loss risk. The only cost is a blob src set milliseconds before
    // stop stays un-rewritten (pre-fix behavior for that one image). Events
    // are worth more than one image.
    flushSync();
    // blobDataURLCache is module-level, page-lifetime state (see start()) —
    // clear it at the end of the session too so it never accumulates full
    // base64 image bytes across repeated record sessions on a long-lived SPA.
    blobDataURLCache.clear();
  }

  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.__oj !== FROM_RELAY) return;
    // The relay forwards start/stop. A {stop:true} answer to a batch (orphaned
    // recorder, e.g. the debug banner was dismissed) also arrives here as "stop".
    if (e.data.kind === "start") start();
    else if (e.data.kind === "stop") stop();
  });

  // Don't lose the last partial batch when the page navigates away. Uses the
  // synchronous drain: an unloading page can't await the blob rewrites.
  window.addEventListener("pagehide", flushSync);

  // Announce readiness: a relay that loaded first (or resumed after a
  // mid-recording navigation) re-sends "start" once it sees this.
  post("ready");
}

// Guard against double injection (manifest entry + scripting.executeScript
// fallback). The flag lives on the page window, shared across MAIN-world runs.
if (!window.__ojRecorderLoaded) {
  window.__ojRecorderLoaded = true;
  main();
}
