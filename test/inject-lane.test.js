import { test, expect } from "bun:test";
import { pageEventToTimeline, mergeNetworkEnd } from "../src/lanes/inject.js";

test("probe records map onto the CDP event schema", () => {
  expect(pageEventToTimeline({ kind: "console", level: "warning", t: 1, message: "m", stack: ["a — b:1:1"] })).toEqual({
    t: 1, kind: "console", level: "warning", title: "m", detail: { message: "m", stack: ["a — b:1:1"] },
  });
  const err = pageEventToTimeline({ kind: "error", t: 2, message: "Error: boom\n at x", url: "u", line: 1, column: 2 });
  expect(err.title).toBe("Error: boom");
  expect(err.detail).toEqual({ message: "Error: boom\n at x", url: "u", line: 1, column: 2, stack: [] });
  const net = pageEventToTimeline({ kind: "net-start", t: 3, requestId: "f1", method: "GET", url: "https://a/", resourceType: "fetch", requestHeaders: {} });
  expect(net.title).toBe("GET https://a/");
  expect(net.detail).toMatchObject({ requestId: "f1", status: null, failed: false, requestBody: null });
  expect(pageEventToTimeline({ kind: "net-end" })).toBeNull();
});

test("net-end merges into the start event; failures retitle like the CDP lane", () => {
  const ev = pageEventToTimeline({ kind: "net-start", t: 3, requestId: "f1", method: "GET", url: "https://a/", resourceType: "fetch" });
  mergeNetworkEnd(ev, { status: 200, statusText: "OK", mimeType: "text/plain", responseHeaders: { a: "1" }, durationMs: 12, encodedBytes: 4, responseBody: "body", failed: false });
  expect(ev.detail).toMatchObject({ status: 200, statusText: "OK", mimeType: "text/plain", responseHeaders: { a: "1" }, durationMs: 12, encodedBytes: 4, responseBody: "body", remoteAddress: null });
  const bad = pageEventToTimeline({ kind: "net-start", t: 3, requestId: "f2", method: "GET", url: "https://b/", resourceType: "fetch" });
  mergeNetworkEnd(bad, { failed: true, errorText: "TypeError: Failed to fetch", durationMs: 3 });
  expect(bad.title).toBe("FAILED https://b/");
  expect(bad.detail).toMatchObject({ failed: true, errorText: "TypeError: Failed to fetch", durationMs: 3 });
});
