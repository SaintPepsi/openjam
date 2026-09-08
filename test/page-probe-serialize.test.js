import { test, expect } from "bun:test";
import { serializeArgs, captureStack } from "../src/page-probe/serialize.js";

test("formats console arguments like the CDP lane: strings raw, objects compact", () => {
  expect(serializeArgs(["counter is now", 3])).toBe("counter is now 3");
  expect(serializeArgs([{ b: [1, 2], s: "x" }])).toBe('{"b":[1,2],"s":x}');
  expect(serializeArgs([null, undefined, true])).toBe("null undefined true");
  expect(serializeArgs([function fooBar() {}])).toBe("function fooBar()");
});

test("cycles, depth and size are bounded", () => {
  const a = { name: "a" };
  a.self = a;
  expect(serializeArgs([a])).toContain("[Circular]");
  expect(serializeArgs([{ l1: { l2: { l3: { l4: 1 } } } }])).toBe('{"l1":{"l2":{"l3":{…}}}}');
  const big = "x".repeat(5000);
  const out = serializeArgs([big]);
  expect(out.length).toBe(1001);
  expect(out.endsWith("…")).toBe(true);
});

test("errors serialize to their stack, class instances keep their name", () => {
  class Thing {
    constructor() {
      this.v = 1;
    }
  }
  expect(serializeArgs([new Thing()])).toBe('Thing {"v":1}');
  expect(serializeArgs([new Error("boom")])).toMatch(/^Error: boom/);
});

test("captureStack returns name — location frames and drops the probe's own frames", () => {
  function outerFrame() {
    return captureStack(0);
  }
  const frames = outerFrame();
  expect(frames.length).toBeGreaterThan(0);
  // Function naming differs per engine (bun reports <anonymous> here, Chrome
  // "outerFrame"); the contract is the shape and that our own frame is gone.
  expect(frames[0]).toMatch(/^.+ — .*page-probe-serialize\.test\.js:\d+:\d+$/);
  expect(frames.some((f) => f.includes("src/page-probe/serialize.js"))).toBe(false);
});
