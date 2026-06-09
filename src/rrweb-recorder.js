// rrweb session recorder. Runs as an ISOLATED-world content script at
// document_start; bundled by build.mjs into dist/rrweb-recorder.js.
// Streams events to the background in small batches so nothing is lost on
// navigation and no single message grows unbounded.
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
      chrome.runtime.sendMessage({ type: "oj-rrweb-batch", events: batch });
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
