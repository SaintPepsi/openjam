import { test, expect } from "bun:test";
import { KIND, KINDS, LEGEND } from "../event-kinds.js";

test("KINDS lists every kind the recorder emits", () => {
  expect([...KINDS].sort()).toEqual(["console", "error", "log", "network", "screenshot"]);
});

test("KIND values match KINDS", () => {
  expect(Object.values(KIND).sort()).toEqual([...KINDS].sort());
});

test("LEGEND documents every kind", () => {
  for (const k of KINDS) expect(typeof LEGEND[k]).toBe("string");
  expect(Object.keys(LEGEND).sort()).toEqual([...KINDS].sort());
});
