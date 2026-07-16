// Bridge tests for the isolated-world relay (src/rrweb-relay.js): it must
// forward the MAIN-world recorder's batches to the background over
// chrome.runtime.sendMessage, relay start/stop commands back to the recorder
// over window.postMessage, resume after a mid-recording navigation (hello), and
// re-issue start when a reloaded recorder announces readiness.
import { test, expect } from "bun:test";

const TO_RELAY = "oj-rec-to-relay"; // recorder -> relay
const FROM_RELAY = "oj-relay-to-rec"; // relay -> recorder

const env = { helloResponse: { record: false }, batchResponse: { ok: true }, lastError: undefined };
const sent = [];
const runtimeListeners = [];
const windowEvents = {};
const posted = [];

globalThis.window = {
  addEventListener(name, fn) {
    windowEvents[name] = fn;
  },
  postMessage(msg) {
    posted.push(msg);
  },
};
globalThis.chrome = {
  runtime: {
    get lastError() {
      return env.lastError;
    },
    sendMessage(msg, cb) {
      sent.push(msg);
      if (msg.type === "oj-rrweb-hello") return void (cb && cb(env.helloResponse));
      if (msg.type === "oj-rrweb-batch") return void (cb && cb(env.batchResponse));
    },
    onMessage: {
      addListener(fn) {
        runtimeListeners.push(fn);
      },
    },
  },
};

function fromBackground(action) {
  let response;
  for (const fn of runtimeListeners) fn({ action }, {}, (r) => (response = r));
  return response;
}
function fromRecorder(kind, extra) {
  windowEvents.message({ source: globalThis.window, data: { __oj: TO_RELAY, kind, ...extra } });
}
const toRecorder = () => posted.filter((m) => m.__oj === FROM_RELAY).map((m) => m.kind);

// hello resolves {record:true} on load → the relay should resume the recorder.
env.helloResponse = { record: true };
await import("../src/rrweb-relay.js");

test("on load, sends hello and resumes the recorder when the background is recording", () => {
  expect(sent.some((m) => m.type === "oj-rrweb-hello")).toBe(true);
  expect(toRecorder()).toContain("start");
});

test("relays a background start command to the recorder and acks it", () => {
  const before = toRecorder().length;
  const res = fromBackground("oj-rrweb-start");
  expect(res).toEqual({ ok: true });
  expect(toRecorder().slice(before)).toContain("start");
});

test("forwards the recorder's batch JSON string to the background verbatim (no parse)", () => {
  // The recorder carries batches as a JSON STRING (eventsJson) so deep DOM clears
  // Chrome's Mojo ~100-depth cap on this chrome.runtime.sendMessage hop. The relay
  // must forward that string untouched — parsing here would re-introduce the
  // nesting the string exists to avoid.
  const before = sent.length;
  const eventsJson = JSON.stringify([{ type: 3, timestamp: 1 }]);
  fromRecorder("batch", { eventsJson });
  const batch = sent.slice(before).find((m) => m.type === "oj-rrweb-batch");
  expect(batch).toBeTruthy();
  expect(batch.eventsJson).toBe(eventsJson); // forwarded verbatim as a string
  expect(JSON.parse(batch.eventsJson).length).toBe(1);
});

test("stops the recorder when the background answers a batch with {stop:true}", () => {
  env.batchResponse = { stop: true };
  const before = toRecorder().length;
  fromRecorder("batch", { eventsJson: JSON.stringify([{ type: 3, timestamp: 2 }]) });
  expect(toRecorder().slice(before)).toContain("stop");
  env.batchResponse = { ok: true };
});

test("relays a background stop command and acks it", () => {
  const before = toRecorder().length;
  const res = fromBackground("oj-rrweb-stop");
  expect(res).toEqual({ ok: true });
  expect(toRecorder().slice(before)).toContain("stop");
});

test("re-issues start when a reloaded recorder announces readiness mid-recording", () => {
  fromBackground("oj-rrweb-start"); // recording = true again
  const before = toRecorder().length;
  fromRecorder("ready");
  expect(toRecorder().slice(before)).toContain("start");
});

test("ignores a recorder ready announcement when not recording", () => {
  fromBackground("oj-rrweb-stop"); // recording = false
  const before = toRecorder().length;
  fromRecorder("ready");
  expect(toRecorder().slice(before)).not.toContain("start");
});
