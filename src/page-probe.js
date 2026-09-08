// Page probe — the inject lane's eyes in the MAIN world. Injected by
// src/lanes/inject.js into the recorded tab only (never a manifest script);
// patches console.*, fetch and XMLHttpRequest and listens for uncaught errors,
// but only EMITS once the background arms it. Talks to the isolated-world relay
// (src/rrweb-relay.js) over window.postMessage using the recorder's envelope,
// except on pagehide (see flushSync). Bundled to dist/page-probe.js.
import { serializeArgs, captureStack } from "./page-probe/serialize.js";
import { installNetworkProbe } from "./page-probe/network.js";

const FLUSH_INTERVAL_MS = 500;
const TO_RELAY = "oj-rec-to-relay";
const FROM_RELAY = "oj-relay-to-rec";
const FLUSH_EVENT = "oj-probe-flush"; // DOM event: synchronous cross-world hop for pagehide
const LEVELS = { log: "log", info: "info", warn: "warning", error: "error", debug: "debug" };

function main() {
  let armed = false;
  let buffer = [];
  let timer = null;

  function drain() {
    timer = null;
    if (!buffer.length) return null;
    const eventsJson = JSON.stringify(buffer);
    buffer = [];
    return eventsJson;
  }

  function flush() {
    const eventsJson = drain();
    if (eventsJson) window.postMessage({ __oj: TO_RELAY, kind: "probe-batch", eventsJson }, "*");
  }

  // pagehide: a postMessage is a queued task and dies with the document, so
  // anything buffered in the last 500 ms before a navigation would be lost. A
  // DOM event is dispatched synchronously to every world's listeners; the relay
  // hands the batch to the background before the document goes.
  function flushSync() {
    const eventsJson = drain();
    if (eventsJson) document.dispatchEvent(new CustomEvent(FLUSH_EVENT, { detail: eventsJson }));
  }

  function emit(ev) {
    if (!armed) return;
    buffer.push(ev);
    if (!timer) timer = setTimeout(flush, FLUSH_INTERVAL_MS);
  }

  for (const method of Object.keys(LEVELS)) {
    const orig = console[method];
    if (typeof orig !== "function") continue;
    const level = LEVELS[method];
    console[method] = function () {
      if (!armed) return orig.apply(this, arguments); // disarmed: one boolean, no serialization
      try {
        const message = serializeArgs(arguments);
        emit({ kind: "console", level, t: Date.now(), message, stack: level === "error" || level === "warning" ? captureStack(1) : [] });
      } catch {
        // bookkeeping must never break the page's console
      }
      return orig.apply(this, arguments);
    };
  }

  window.addEventListener("error", (e) => {
    const err = e.error;
    const message = err && err.stack ? String(err.stack) : String(e.message || "Uncaught exception");
    emit({ kind: "error", t: Date.now(), message, url: e.filename || null, line: e.lineno || null, column: e.colno || null });
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    const message = "Unhandled promise rejection: " + (r && r.stack ? r.stack : String(r));
    emit({ kind: "error", t: Date.now(), message, url: null, line: null, column: null });
  });

  installNetworkProbe({ emit, isArmed: () => armed });

  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.__oj !== FROM_RELAY) return;
    if (e.data.kind === "probe-start") armed = true;
    else if (e.data.kind === "probe-stop") {
      flush();
      armed = false;
    }
  });
  window.addEventListener("pagehide", flushSync);
  window.postMessage({ __oj: TO_RELAY, kind: "probe-ready" }, "*");
}

if (!window.__ojProbeLoaded) {
  window.__ojProbeLoaded = true;
  main();
}
