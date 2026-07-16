// Isolated-world bridge between the MAIN-world rrweb recorder
// (src/rrweb-recorder.js) and the background worker. The recorder must run in
// the MAIN world to observe the page's runtime CSS (insertRule /
// adoptedStyleSheets), but the MAIN world has no chrome.* APIs — so this relay
// forwards the recorder's event batches to the background over
// chrome.runtime.sendMessage and relays start/stop commands back to the
// recorder over window.postMessage. Bundled by build.mjs into
// dist/rrweb-relay.js.
const TO_RELAY = "oj-rec-to-relay"; // envelope tag for messages from the recorder
const FROM_RELAY = "oj-relay-to-rec"; // envelope tag for messages to the recorder

function main() {
  // Whether the background wants this page recorded. Tracked so a recorder that
  // announces "ready" after we already know (e.g. it loaded second, or resumed
  // after navigation) gets told to start.
  let recording = false;

  function toRecorder(kind) {
    window.postMessage({ __oj: FROM_RELAY, kind }, "*");
  }

  // Recorder → background.
  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.__oj !== TO_RELAY) return;
    const msg = e.data;
    if (msg.kind === "batch") {
      try {
        // Forward the batch as the JSON string the recorder produced. The verified
        // cliff is chrome.storage.local.set, not this sendMessage hop — isolation
        // testing showed the MV3 structured clone carries a deep array through
        // sendMessage intact. Parsing here would just break the one-string-
        // contract-everywhere defense-in-depth, so keep it a string regardless.
        chrome.runtime.sendMessage({ type: "oj-rrweb-batch", eventsJson: msg.eventsJson }, (res) => {
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
    } else if (msg.kind === "ready" && recording) {
      toRecorder("start");
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
