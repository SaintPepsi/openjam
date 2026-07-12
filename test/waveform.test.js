import { test, expect } from "bun:test";
import { extractPeaks } from "../waveform.js";

test("extractPeaks normalizes the loudest bar to 1", () => {
  // 8 samples, 4 bars → 2 samples/bar. Bar 2 holds the loudest sample (0.5).
  const s = new Float32Array([0.1, -0.1, 0.2, -0.2, 0.5, 0.0, 0.25, -0.25]);
  const peaks = extractPeaks(s, 4);
  expect(peaks.length).toBe(4);
  expect(Math.max(...peaks)).toBeCloseTo(1, 5); // loudest bar normalized to 1
  expect(peaks[2]).toBeCloseTo(1, 5);           // bar 2 is the loudest
  expect(peaks[0]).toBeCloseTo(0.2, 5);         // bar 0 max = 0.1, normalized 0.1/0.5 = 0.2
});

test("silence yields all-zero peaks (disconfirming: no divide-by-zero spike)", () => {
  const peaks = extractPeaks(new Float32Array(16), 8);
  expect(peaks.length).toBe(8);
  expect(peaks.every((p) => p === 0)).toBe(true);
});

test("a single spike lights exactly one bar", () => {
  const s = new Float32Array(12); // 12 samples, 6 bars → 2/bar
  s[0] = 0.9;                     // spike in bar 0
  const peaks = extractPeaks(s, 6);
  expect(peaks[0]).toBeCloseTo(1, 5);
  expect(peaks.slice(1).every((p) => p === 0)).toBe(true);
});
