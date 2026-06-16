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
