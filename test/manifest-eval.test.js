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

test("bytes-to-diagnosis: failure is reachable from the manifest; the raw blob is opaque without decoding", () => {
  const html = buildReportHTML(fixtureReport(), null);
  const aiStart = html.indexOf('id="openjam-ai"');
  const aiEnd = html.indexOf("</script>", aiStart);
  const phraseInManifest = html.indexOf(GROUND_TRUTH.phrase, aiStart);
  expect(phraseInManifest).toBeGreaterThan(-1);
  expect(phraseInManifest).toBeLessThan(aiEnd); // the answer lives inside the small top block

  // #openjam-data is gzip+base64'd (issue #44) — the raw HTML bytes contain no
  // plaintext at all, so a naive scan can't reach the phrase at ANY offset;
  // only the manifest (uncompressed, on purpose — see manifest.js) can. This is
  // now a stronger property than "sooner": the raw blob is unreachable by text
  // search, period, without running the codec (src/generated/codec.js) first.
  const dataStart = html.indexOf('id="openjam-data"');
  const dataEnd = html.indexOf("</script>", dataStart);
  expect(html.slice(dataStart, dataEnd)).not.toContain(GROUND_TRUTH.phrase);
  expect(html.indexOf(GROUND_TRUTH.phrase, dataStart)).toBe(-1);
});
