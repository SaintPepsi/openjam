// Isolated-world bridge between the MAIN-world rrweb recorder
// (src/rrweb-recorder.js) and the background worker. The recorder must run in
// the MAIN world to observe the page's runtime CSS (insertRule /
// adoptedStyleSheets), but the MAIN world has no chrome.* APIs — so this relay
// forwards the recorder's event batches to the background over
// chrome.runtime.sendMessage and relays start/stop commands back to the
// recorder over window.postMessage. Bundled by build.mjs into
// dist/rrweb-relay.js.
import { collectDeviceInfo } from "./device-info.js";

const TO_RELAY = "oj-rec-to-relay"; // envelope tag for messages from the recorder
const FROM_RELAY = "oj-relay-to-rec"; // envelope tag for messages to the recorder
const PROBE_FLUSH_EVENT = "oj-probe-flush"; // the probe's synchronous pagehide hop
const RECORDER_FLUSH_EVENT = "oj-recorder-flush"; // the recorder's

function main() {
  // Whether the background wants this page recorded. Tracked so a recorder that
  // announces "ready" after we already know (e.g. it loaded second, or resumed
  // after navigation) gets told to start.
  let recording = false;
  // Whether the background wants the page probe (inject lane) armed. Same
  // ready/start handshake as the recorder, so load order never matters.
  let probe = false;

  function toRecorder(kind) {
    window.postMessage({ __oj: FROM_RELAY, kind }, "*");
  }

  function forwardRecorderBatch(eventsJson) {
    try {
      // Forward the batch as the JSON string the recorder produced. The verified
      // cliff is chrome.storage.local.set, not this sendMessage hop — isolation
      // testing showed the MV3 structured clone carries a deep array through
      // sendMessage intact. Parsing here would just break the one-string-
      // contract-everywhere defense-in-depth, so keep it a string regardless.
      chrome.runtime.sendMessage({ type: "oj-rrweb-batch", eventsJson }, (res) => {
        if (chrome.runtime.lastError) return;
        // {stop:true}: the session ended without the recorder being told
        // (e.g. debug banner dismissed) — stop serializing the page.
        if (res && res.stop) {
          recording = false;
          toRecorder("stop");
        }
      });
    } catch {
      // extension reloaded mid-recording — nothing useful to do
    }
  }

  function forwardProbeBatch(eventsJson) {
    try {
      chrome.runtime.sendMessage({ type: "oj-page-batch", eventsJson }, (res) => {
        if (chrome.runtime.lastError) return;
        if (res && res.stop) {
          probe = false;
          toRecorder("probe-stop");
        }
      });
    } catch {
      // extension reloaded mid-recording — nothing useful to do
    }
  }

  // Recorder/probe → background, the synchronous way (pagehide). detail is a
  // string: primitives cross the world boundary, objects don't.
  document.addEventListener(RECORDER_FLUSH_EVENT, (e) => {
    if (typeof e.detail === "string") forwardRecorderBatch(e.detail);
  });
  document.addEventListener(PROBE_FLUSH_EVENT, (e) => {
    if (typeof e.detail === "string") forwardProbeBatch(e.detail);
  });

  // Recorder → background.
  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.__oj !== TO_RELAY) return;
    const msg = e.data;
    if (msg.kind === "batch") {
      forwardRecorderBatch(msg.eventsJson);
    } else if (msg.kind === "ready" && recording) {
      toRecorder("start");
    } else if (msg.kind === "probe-batch") {
      forwardProbeBatch(msg.eventsJson);
    } else if (msg.kind === "probe-ready" && probe) {
      toRecorder("probe-start");
    }
  });

  // Background → recorder (start/stop commands).
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === "oj-rrweb-start") {
      recording = true;
      toRecorder("start");
      sendResponse({ ok: true });
    } else if (msg.action === "oj-rrweb-stop") {
      recording = false;
      toRecorder("stop");
      sendResponse({ ok: true });
    } else if (msg.action === "oj-probe-start") {
      probe = true;
      toRecorder("probe-start");
      sendResponse({ ok: true });
    } else if (msg.action === "oj-probe-stop") {
      probe = false;
      toRecorder("probe-stop");
      sendResponse({ ok: true });
    } else if (msg.action === "oj-device-info") {
      sendResponse(collectDeviceInfo());
    }
  });

  // If this page loaded mid-recording (navigation), ask the background whether
  // to resume; if so, start the recorder (now or once it announces readiness).
  try {
    chrome.runtime.sendMessage({ type: "oj-rrweb-hello" }, (res) => {
      if (chrome.runtime.lastError) return;
      if (res && res.record) {
        recording = true;
        toRecorder("start");
      }
      if (res && res.probe) {
        probe = true;
        toRecorder("probe-start");
      }
    });
  } catch {
    // extension context gone — ignore
  }
}

// Guard against double injection (manifest entry + scripting.executeScript
// fallback). This flag lives on the isolated world's window.
if (!window.__ojRelayLoaded) {
  window.__ojRelayLoaded = true;
  main();
}
