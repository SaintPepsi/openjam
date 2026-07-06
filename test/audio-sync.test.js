import { test, expect } from "bun:test";
import { audioTimeFor, wallForAudioTime } from "../audio-sync.js";

test("maps a mid-session wall to offset seconds", () => {
  expect(audioTimeFor(1000 + 5000, 1000, 10000)).toBe(5);
});
test("clamps a wall before start to 0", () => {
  expect(audioTimeFor(999, 1000, 10000)).toBe(0);
});
test("clamps a wall past the end to durationMs", () => {
  expect(audioTimeFor(1000 + 999999, 1000, 10000)).toBe(10);
});
test("null/absent duration is a no-op (0)", () => {
  expect(audioTimeFor(5000, 1000, null)).toBe(0);
});
test("wallForAudioTime is the inverse of the offset math", () => {
  expect(wallForAudioTime(5, 1000)).toBe(6000);
});
