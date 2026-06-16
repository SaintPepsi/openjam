// test/manifest-eval.test.js
import { test, expect } from "bun:test";
import { buildReportHTML } from "../report-builder.js";
import { buildManifest } from "../manifest.js";
import { fixtureReport, GROUND_TRUTH } from "../eval/fixture-report.mjs";

test("manifest surfaces the planted failure (index, status, message)", () => {
  const report = fixtureReport();
  const m = buildManifest(report);
  expect(m.failures).toHaveLength(1);
  const f = m.failures[0];
  expect(report.events[f.i].title).toBe(GROUND_TRUTH.endpoint);
  expect(f.status).toBe(GROUND_TRUTH.status);
  expect(f.message).toContain(GROUND_TRUTH.phrase);
});

test("bytes-to-diagnosis: failure is reachable from the manifest far sooner than from the raw blob", () => {
  const html = buildReportHTML(fixtureReport(), null);
  const aiStart = html.indexOf('id="openjam-ai"');
  const aiEnd = html.indexOf("</script>", aiStart);
  const phraseInManifest = html.indexOf(GROUND_TRUTH.phrase, aiStart);
  expect(phraseInManifest).toBeGreaterThan(-1);
  expect(phraseInManifest).toBeLessThan(aiEnd); // the answer lives inside the small top block

  const dataStart = html.indexOf('id="openjam-data"');
  const phraseInData = html.indexOf(GROUND_TRUTH.phrase, dataStart);
  expect(aiEnd).toBeLessThan(phraseInData); // manifest ends before the buried event
  // quantify "easier to find": reaching the manifest's end costs < half the bytes
  // of reaching the failure by scanning the raw timeline.
  expect(aiEnd / phraseInData).toBeLessThan(0.5);
});
