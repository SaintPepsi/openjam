import { test, expect } from "bun:test";
import { buildManifest } from "../manifest.js";

function report(events) {
  return { meta: {}, events };
}

test("counts events per kind and derives console.error", () => {
  const m = buildManifest(
    report([
      { t: 1, kind: "network", title: "GET /a", detail: { status: 200 } },
      { t: 2, kind: "console", level: "log", title: "hi", detail: { message: "hi" } },
      { t: 3, kind: "console", level: "error", title: "boom", detail: { message: "boom" } },
    ]),
  );
  expect(m.counts.network).toBe(1);
  expect(m.counts.console).toBe(2);
  expect(m.counts["console.error"]).toBe(1);
  expect(m.counts.error).toBe(0);
});

test("schema legend documents every kind", () => {
  const m = buildManifest(report([]));
  expect(Object.keys(m.schema).sort()).toEqual(["console", "error", "log", "network", "screenshot"]);
  expect(typeof m._doc).toBe("string");
});

test("empty report yields zeroed counts and no failures", () => {
  const m = buildManifest(report([]));
  expect(m.counts.network).toBe(0);
  expect(m.failures).toEqual([]);
});

test("tolerates a missing events array", () => {
  expect(() => buildManifest({})).not.toThrow();
  expect(buildManifest({}).failures).toEqual([]);
});

test("indexes HTTP failures with status and response body as message", () => {
  const m = buildManifest(
    report([
      { t: 1, kind: "network", title: "GET /ok", detail: { status: 200 } },
      { t: 2, kind: "network", title: "PATCH /diaries/5", detail: { status: 400, responseBody: "Cannot save changes for 2026-06-19" } },
    ]),
  );
  expect(m.failures).toHaveLength(1);
  expect(m.failures[0]).toMatchObject({ i: 1, kind: "network", status: 400, title: "PATCH /diaries/5", message: "Cannot save changes for 2026-06-19" });
});

test("indexes network transport failures via errorText", () => {
  const m = buildManifest(report([{ t: 1, kind: "network", title: "FAILED /x", detail: { failed: true, errorText: "net::ERR_FAILED" } }]));
  expect(m.failures[0]).toMatchObject({ i: 0, kind: "network", message: "net::ERR_FAILED" });
  // a transport failure has no HTTP status — don't carry a phantom `status` key
  expect(m.failures[0]).not.toHaveProperty("status");
});

test("indexes thrown errors and console errors", () => {
  const m = buildManifest(
    report([
      { t: 1, kind: "error", title: "TypeError: x", detail: { message: "TypeError: x is not a function" } },
      { t: 2, kind: "console", level: "error", title: "bad", detail: { message: "bad thing" } },
    ]),
  );
  expect(m.failures.map((f) => f.i)).toEqual([0, 1]);
  expect(m.failures[0].message).toBe("TypeError: x is not a function");
  expect(m.failures[1].message).toBe("bad thing");
});

test("truncates failure messages to 500 chars + ellipsis", () => {
  const long = "x".repeat(600);
  const m = buildManifest(report([{ t: 1, kind: "error", title: "e", detail: { message: long } }]));
  expect(m.failures[0].message.length).toBe(501); // 500 + "…"
  expect(m.failures[0].message.endsWith("…")).toBe(true);
});

test("truncation never leaves a dangling surrogate at the boundary", () => {
  // "a" + emoji shifts the 500-code-unit cut to land mid surrogate pair.
  const msg = "a" + "😀".repeat(600);
  const m = buildManifest(report([{ t: 1, kind: "error", title: "e", detail: { message: msg } }]));
  const out = m.failures[0].message;
  expect(out.endsWith("…")).toBe(true);
  const before = out.slice(0, -1);
  const lastCode = before.charCodeAt(before.length - 1);
  expect(lastCode >= 0xd800 && lastCode <= 0xdbff).toBe(false); // no lone lead surrogate
  expect(() => JSON.parse(JSON.stringify(m))).not.toThrow(); // still serialises cleanly
});

test("caps failures[] at 100 and reports the overflow via failuresOmitted", () => {
  const events = Array.from({ length: 105 }, (_, i) => ({ t: i, kind: "error", title: "e" + i, detail: { message: "boom" + i } }));
  const m = buildManifest(report(events));
  expect(m.failures).toHaveLength(100);
  expect(m.failuresOmitted).toBe(5);
  expect(m.counts.error).toBe(105); // counts still reflect the true total
});

test("small reports report zero failuresOmitted", () => {
  const m = buildManifest(report([{ t: 1, kind: "error", title: "e", detail: { message: "x" } }]));
  expect(m.failuresOmitted).toBe(0);
});

test("tolerates a null report", () => {
  expect(() => buildManifest(null)).not.toThrow();
  expect(buildManifest(null).failures).toEqual([]);
});

test("includes audio metadata when report.audio is present", () => {
  const m = buildManifest({ events: [], audio: { dataUrl: "data:audio/webm;base64,AA", mime: "audio/webm;codecs=opus", startWall: 1, durationMs: 4200 } });
  expect(m.audio).toEqual({ durationMs: 4200, mime: "audio/webm;codecs=opus" });
});
test("omits audio key when report.audio is null", () => {
  const m = buildManifest({ events: [], audio: null });
  expect(m.audio).toBeUndefined();
});
