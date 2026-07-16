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
const TO_RELAY = "oj-rec-to-relay"; // envelope tag for messages we send
const FROM_RELAY = "oj-relay-to-rec"; // envelope tag for messages we receive

function main() {
  let stopFn = null;
  let buffer = [];
  let flushTimer = null;

  function post(kind, extra) {
    window.postMessage({ __oj: TO_RELAY, kind, ...extra }, "*");
  }

  function flush() {
    if (!buffer.length) return;
    const events = buffer;
    buffer = []; // drain before posting so a failed transport never re-buffers
    post("batch", { events });
  }

  function start() {
    if (stopFn) return;
    // Inline image bytes as data: URIs at record time. blob:/cross-origin <img>
    // srcs are dead outside the origin tab, so a standalone export renders them
    // broken; inlineImages draws each already-loaded image to an offscreen canvas
    // (no re-fetch, stays local-only) and stores the pixels as rr_dataURL.
    // Ships default PNG (lossless); unlimitedStorage lifts the storage quota.
    // Size knob if reports prove too large (reversible fast-follow):
    // dataURLOptions: { type: "image/jpeg", quality: 0.8 }.
    stopFn = record({
      inlineImages: true,
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

  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.__oj !== FROM_RELAY) return;
    // The relay forwards start/stop. A {stop:true} answer to a batch (orphaned
    // recorder, e.g. the debug banner was dismissed) also arrives here as "stop".
    if (e.data.kind === "start") start();
    else if (e.data.kind === "stop") stop();
  });

  // Don't lose the last partial batch when the page navigates away.
  window.addEventListener("pagehide", flush);

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
