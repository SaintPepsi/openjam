// Page probe — the inject lane's eyes in the MAIN world. Injected by
// src/lanes/inject.js into the recorded tab only (never a manifest script);
// patches console.*, fetch and XMLHttpRequest and listens for uncaught errors,
// but only EMITS once the background arms it. Talks to the isolated-world relay
// (src/rrweb-relay.js) over the recorder's envelope (src/wire.js). Bundled to
// dist/page-probe.js.
import { serializeArgs, captureStack } from "./page-probe/serialize.js";
import { installNetworkProbe } from "./page-probe/network.js";
import { TO_RELAY, FROM_RELAY, FLUSH_INTERVAL_MS, PROBE_FLUSH_EVENT } from "./wire.js";

const LEVELS = { log: "log", info: "info", warn: "warning", error: "error", debug: "debug" };

function main() {
  let armed = false;
  let buffer = [];
  let timer = null;

  // onPagehide: use the synchronous DOM-event hop instead of postMessage (see
  // src/wire.js).
  function flush(onPagehide) {
    timer = null;
    if (!buffer.length) return;
    const eventsJson = JSON.stringify(buffer);
    buffer = [];
    if (onPagehide === true) document.dispatchEvent(new CustomEvent(PROBE_FLUSH_EVENT, { detail: eventsJson }));
    else window.postMessage({ __oj: TO_RELAY, kind: "probe-batch", eventsJson }, "*");
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
    if (!armed) return;
    const err = e.error;
    const message = err && err.stack ? String(err.stack) : String(e.message || "Uncaught exception");
    emit({ kind: "error", t: Date.now(), message, url: e.filename || null, line: e.lineno || null, column: e.colno || null });
  });
  window.addEventListener("unhandledrejection", (e) => {
    if (!armed) return;
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
  window.addEventListener("pagehide", () => flush(true));
  window.postMessage({ __oj: TO_RELAY, kind: "probe-ready" }, "*");
}

if (!window.__ojProbeLoaded) {
  window.__ojProbeLoaded = true;
  main();
}
