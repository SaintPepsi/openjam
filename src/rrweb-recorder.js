// rrweb session recorder. Runs as an ISOLATED-world content script at
// document_start; bundled by build.mjs into dist/rrweb-recorder.js.
// Streams events to the background in small batches (plus a pagehide flush so
// the tail of a navigation isn't lost) and no single message grows unbounded.
// If the background answers a batch with {stop:true} the session has ended
// (e.g. the user dismissed the debug banner) — stop recording immediately
// rather than serializing the page forever.
import { record } from "rrweb";

const FLUSH_INTERVAL_MS = 500;

function main() {
  let stopFn = null;
  let buffer = [];
  let flushTimer = null;

  function flush() {
    if (!buffer.length) return;
    const batch = buffer;
    buffer = [];
    try {
      chrome.runtime.sendMessage({ type: "oj-rrweb-batch", events: batch }, (res) => {
        if (chrome.runtime.lastError) return;
        if (res && res.stop) stop();
      });
    } catch {
      // extension reloaded mid-recording — nothing useful to do
    }
  }

  function start() {
    if (stopFn) return;
    stopFn = record({
      emit(event) {
        buffer.push(event);
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
    flush();
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === "oj-rrweb-start") {
      start();
      sendResponse({ ok: true });
    } else if (msg.action === "oj-rrweb-stop") {
      stop();
      sendResponse({ ok: true });
    }
  });

  // Don't lose the last partial batch when the page navigates away.
  window.addEventListener("pagehide", flush);

  // If this page loaded mid-recording (navigation), ask whether to resume.
  chrome.runtime.sendMessage({ type: "oj-rrweb-hello" }, (res) => {
    if (chrome.runtime.lastError) return;
    if (res && res.record) start();
  });
}

// Guard against double injection (manifest + scripting.executeScript fallback).
if (!window.__ojRecorderLoaded) {
  window.__ojRecorderLoaded = true;
  main();
}
