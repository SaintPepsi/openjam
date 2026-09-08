// Page probe — the inject lane's eyes in the MAIN world. Installed at
// document_start next to the rrweb recorder; patches console.*, fetch and
// XMLHttpRequest and listens for uncaught errors, but only EMITS once the
// background arms it (session.capture === "inject", see src/lanes/inject.js).
// On the cdp lane it stays silent: the debugger sees everything already.
// Talks to the isolated-world relay (src/rrweb-relay.js) over
// window.postMessage using the recorder's envelope. Bundled to dist/page-probe.js.
import { serializeArgs, captureStack } from "./page-probe/serialize.js";
import { installNetworkProbe } from "./page-probe/network.js";

const FLUSH_INTERVAL_MS = 500;
const TO_RELAY = "oj-rec-to-relay";
const FROM_RELAY = "oj-relay-to-rec";
const LEVELS = { log: "log", info: "info", warn: "warning", error: "error", debug: "debug" };

function main() {
  let armed = false;
  let buffer = [];
  let timer = null;

  function flush() {
    timer = null;
    if (!buffer.length) return;
    const eventsJson = JSON.stringify(buffer);
    buffer = [];
    window.postMessage({ __oj: TO_RELAY, kind: "probe-batch", eventsJson }, "*");
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

  installNetworkProbe({ emit });

  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.__oj !== FROM_RELAY) return;
    if (e.data.kind === "probe-start") armed = true;
    else if (e.data.kind === "probe-stop") {
      flush();
      armed = false;
    }
  });
  window.addEventListener("pagehide", flush);
  window.postMessage({ __oj: TO_RELAY, kind: "probe-ready" }, "*");
}

if (!window.__ojProbeLoaded) {
  window.__ojProbeLoaded = true;
  main();
}
