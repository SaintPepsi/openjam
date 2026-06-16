import { test, expect } from "bun:test";
import { KIND, KINDS, LEGEND } from "../event-kinds.js";

test("KINDS lists every kind the recorder emits", () => {
  expect([...KINDS].sort()).toEqual(["console", "error", "log", "network", "screenshot"]);
});

test("kind values are unique", () => {
  expect(new Set(KINDS).size).toBe(KINDS.length);
});

test("LEGEND documents every kind", () => {
  for (const k of KINDS) expect(typeof LEGEND[k]).toBe("string");
  expect(Object.keys(LEGEND).sort()).toEqual([...KINDS].sort());
});

test("LEGEND descriptions match their kind", () => {
  expect(LEGEND[KIND.NETWORK]).toContain("status");
  expect(LEGEND[KIND.ERROR]).toContain("stack");
  expect(LEGEND[KIND.CONSOLE]).toContain("level");
  expect(LEGEND[KIND.SCREENSHOT]).toContain("image");
});
