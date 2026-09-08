// The page probe only emits once armed, forwards every console call to the
// original untouched, and turns uncaught errors / rejections into error records.
import { test, expect, afterAll } from "bun:test";

const TO_RELAY = "oj-rec-to-relay";
const FROM_RELAY = "oj-relay-to-rec";
const FLUSH_WAIT_MS = 650;

const posted = [];
const windowEvents = {};
globalThis.window = {
  addEventListener(name, fn) {
    windowEvents[name] = fn;
  },
  postMessage(msg) {
    posted.push(msg);
  },
};
const origLog = console.log;
const origError = console.error;
const logCalls = [];
console.log = (...a) => logCalls.push(a);

await import("../src/page-probe.js");

const fromRelay = (kind) => windowEvents.message({ source: globalThis.window, data: { __oj: FROM_RELAY, kind } });
const batches = () => posted.filter((m) => m.__oj === TO_RELAY && m.kind === "probe-batch").map((m) => JSON.parse(m.eventsJson));
const wait = () => new Promise((r) => setTimeout(r, FLUSH_WAIT_MS));

test("announces readiness on load", () => {
  expect(posted.some((m) => m.__oj === TO_RELAY && m.kind === "probe-ready")).toBe(true);
});

test("before arming, console calls reach the original and nothing is emitted", async () => {
  console.log("early", 1);
  await wait();
  expect(logCalls).toEqual([["early", 1]]);
  expect(batches()).toEqual([]);
});

test("armed: console, uncaught error and rejection become records; console still forwards", async () => {
  fromRelay("probe-start");
  console.log("counter is now", 2);
  console.error("bad", { x: 1 });
  windowEvents.error({ error: new Error("fixture test error"), message: "Uncaught Error: fixture test error", filename: "http://p/f.js", lineno: 7, colno: 3 });
  windowEvents.unhandledrejection({ reason: "nope" });
  await wait();
  expect(logCalls[1]).toEqual(["counter is now", 2]); // forwarded, untouched
  const recs = batches().flat();
  expect(recs.map((r) => r.kind)).toEqual(["console", "console", "error", "error"]);
  expect(recs[0]).toMatchObject({ level: "log", message: "counter is now 2" });
  expect(recs[1]).toMatchObject({ level: "error", message: 'bad {"x":1}' });
  expect(recs[1].stack.length).toBeGreaterThan(0);
  expect(recs[2]).toMatchObject({ url: "http://p/f.js", line: 7, column: 3 });
  expect(recs[2].message).toMatch(/^Error: fixture test error/);
  expect(recs[3].message).toBe("Unhandled promise rejection: nope");
});

test("probe-stop flushes what is buffered immediately, then goes quiet", async () => {
  const before = batches().length;
  console.log("last words");
  fromRelay("probe-stop");
  expect(batches().length).toBe(before + 1); // flushed synchronously on stop
  console.log("after stop");
  await wait();
  expect(batches().length).toBe(before + 1);
  expect(batches().flat().some((r) => r.message === "after stop")).toBe(false);
});

afterAll(() => {
  console.log = origLog;
  console.error = origError;
});
