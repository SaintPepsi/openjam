// The MAIN-world fetch/XHR probe must report requests with the CDP lane's
// detail keys AND stay invisible to the page: same return value, body still
// readable by the caller (we read a clone), rejections passed through.
import { test, expect } from "bun:test";
import { installNetworkProbe, headersToObject, parseRawHeaders } from "../src/page-probe/network.js";

const flush = () => new Promise((r) => setTimeout(r, 10));

function makeEnv(fetchImpl, opts = {}) {
  const emitted = [];
  const g = { fetch: fetchImpl };
  installNetworkProbe({ emit: (e) => emitted.push(e), now: () => 1000, clock: () => 0, ...opts }, g);
  return { g, emitted };
}

test("fetch: start + end records with status, headers, body; caller can still read the body", async () => {
  const { g, emitted } = makeEnv(async () => new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } }));
  const res = await g.fetch("https://api.test/things", { method: "post", headers: { "x-a": "1" }, body: '{"q":1}' });
  expect(await res.json()).toEqual({ ok: true }); // body not consumed by the probe
  await flush();
  expect(emitted.map((e) => e.kind)).toEqual(["net-start", "net-end"]);
  const [start, end] = emitted;
  expect(start).toMatchObject({ requestId: "f1", method: "POST", url: "https://api.test/things", resourceType: "fetch", requestHeaders: { "x-a": "1" }, requestBody: '{"q":1}' });
  expect(end).toMatchObject({ requestId: "f1", status: 200, mimeType: "application/json", responseBody: '{"ok":true}', failed: false });
  expect(end.responseHeaders["content-type"]).toBe("application/json");
});

test("fetch: binary responses are not read; rejected fetches report failed and still reject for the caller", async () => {
  const { g, emitted } = makeEnv(async (url) => {
    if (url === "png") return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } });
    throw new TypeError("Failed to fetch");
  });
  await g.fetch("png");
  await expect(g.fetch("down")).rejects.toThrow("Failed to fetch");
  await flush();
  const ends = emitted.filter((e) => e.kind === "net-end");
  expect(ends[0].responseBody).toBeUndefined();
  expect(ends[1]).toMatchObject({ failed: true, errorText: "TypeError: Failed to fetch" });
});

test("disarmed: no response body is read; event-stream bodies are never read even when armed", async () => {
  // The probe sits in the page for the whole recording but must cost nothing
  // when not armed: the wrapper hands straight through to the page's fetch.
  // Disconfirming: drop the early isArmed() return → emitted is non-empty.
  let cloned = 0;
  const mk = (type) => {
    const r = new Response("data: x\n\n", { headers: { "content-type": type } });
    const clone = r.clone.bind(r);
    r.clone = () => (cloned++, clone());
    return r;
  };
  const armed = { v: false };
  const { g, emitted } = makeEnv(async () => mk("text/plain"), { isArmed: () => armed.v });
  expect(await (await g.fetch("x")).text()).toBe("data: x\n\n"); // the page's fetch, untouched
  await flush();
  expect(cloned).toBe(0);
  expect(emitted).toEqual([]); // disarmed: nothing inspected, nothing emitted
  armed.v = true;
  await g.fetch("x");
  await flush();
  expect(cloned).toBe(1);
  expect(emitted.at(-1).responseBody).toBe("data: x\n\n");
  // A server-sent-events response never ends: reading it would buffer forever
  // and its net-end would never emit. Disconfirming: drop the event-stream
  // exclusion in classifyBody → cloned becomes 2.
  const sse = makeEnv(async () => mk("text/event-stream"), { isArmed: () => true });
  await sse.g.fetch("stream");
  await flush();
  expect(cloned).toBe(1);
  expect(sse.emitted.at(-1)).toMatchObject({ kind: "net-end", mimeType: "text/event-stream" });
});

test("fetch: a throwing clone() never reaches the page as an unhandled rejection", async () => {
  // Some wrappers return Response-likes whose clone() throws; our bookkeeping
  // branch is off the page's promise chain, so it must swallow its own errors.
  // Disconfirming: remove the .catch on the derived promise → bun reports an
  // unhandled rejection and this test's process-level check fails.
  const unhandled = [];
  const onUnhandled = (err) => unhandled.push(err);
  process.on("unhandledRejection", onUnhandled);
  const res = new Response("ok", { headers: { "content-type": "text/plain" } });
  res.clone = () => {
    throw new Error("no clone for you");
  };
  const { g } = makeEnv(async () => res);
  expect(await (await g.fetch("x")).text()).toBe("ok");
  await flush();
  process.off("unhandledRejection", onUnhandled);
  expect(unhandled).toEqual([]);
});

test("xhr: abort() reports canceled, not a generic network error", () => {
  // Disconfirming: drop the abort listener → canceled:false, errorText "network error".
  const listeners = {};
  class FakeXHR {
    open() {}
    send() {}
    addEventListener(name, fn) {
      listeners[name] = fn;
    }
    getResponseHeader() {
      return null;
    }
    getAllResponseHeaders() {
      return "";
    }
  }
  const emitted = [];
  installNetworkProbe({ emit: (e) => emitted.push(e), now: () => 5, clock: () => 0 }, { XMLHttpRequest: FakeXHR });
  const x = new FakeXHR();
  x.open("get", "https://api.test/slow");
  x.send(null);
  Object.assign(x, { status: 0, statusText: "" });
  listeners.abort();
  listeners.loadend();
  expect(emitted[1]).toMatchObject({ kind: "net-end", failed: true, canceled: true, errorText: "aborted" });
});

test("xhr: open/setRequestHeader/send produce a start, loadend produces the end", () => {
  const listeners = {};
  class FakeXHR {
    open() {}
    setRequestHeader() {}
    send() {}
    addEventListener(name, fn) {
      listeners[name] = fn;
    }
    getResponseHeader(k) {
      return k === "content-type" ? "text/plain; charset=utf-8" : null;
    }
    getAllResponseHeaders() {
      return "content-type: text/plain; charset=utf-8\r\nx-b: 2\r\n";
    }
  }
  const emitted = [];
  installNetworkProbe({ emit: (e) => emitted.push(e), now: () => 5, clock: () => 0 }, { XMLHttpRequest: FakeXHR });
  const x = new FakeXHR();
  x.open("get", "https://api.test/plain");
  x.setRequestHeader("x-a", "1");
  x.send(null);
  Object.assign(x, { status: 404, statusText: "Not Found", responseType: "", responseText: "nope" });
  listeners.loadend();
  expect(emitted[0].requestId).toMatch(/^x\d+$/); // one counter across fetch + xhr
  expect(emitted[1].requestId).toBe(emitted[0].requestId);
  expect(emitted[0]).toMatchObject({ kind: "net-start", method: "GET", url: "https://api.test/plain", resourceType: "xhr", requestHeaders: { "x-a": "1" } });
  expect(emitted[1]).toMatchObject({ kind: "net-end", status: 404, statusText: "Not Found", mimeType: "text/plain", responseBody: "nope", responseHeaders: { "x-b": "2" } });
});

test("header helpers accept Headers, arrays, objects and raw XHR text", () => {
  expect(headersToObject(new Headers({ A: "1" }))).toEqual({ a: "1" });
  expect(headersToObject([["b", "2"]])).toEqual({ b: "2" });
  expect(headersToObject({ c: "3" })).toEqual({ c: "3" });
  expect(parseRawHeaders("X-Y: z\r\nBad line\r\n")).toEqual({ "x-y": "z" });
});
