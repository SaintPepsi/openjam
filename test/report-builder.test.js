// Memory/size tests for the self-contained export (report-builder.js):
// the player UMD must be embedded exactly once regardless of event count,
// export size must grow linearly with events (no accidental duplication),
// and the "<" escaping must inflate hostile content boundedly (< = 6
// bytes per "<", never exponential).
import { test, expect } from "bun:test";
import { buildReportHTML } from "../report-builder.js";

const replayAssets = {
  ENGINE_IIFE: "window.RRWebReplayer=function(){};/*UMD_MARKER*/",
  ENGINE_CSS: ".replayer-wrapper{}",
};

function makeReport(rrwebCount, { title = "ok" } = {}) {
  return {
    meta: { capturedAt: 1717900000000, durationMs: 1000, pageUrl: "https://t", pageTitle: "T", eventCount: 1 },
    device: { viewport: { width: 100, height: 100 } },
    events: [{ id: 1, t: 1717900000000, rel: 0, kind: "console", level: "log", title, detail: { message: "m" } }],
    rrwebEvents: Array.from({ length: rrwebCount }, (_, i) => ({
      type: 3,
      data: { source: 1, positions: [{ x: i, y: i, id: 1, timeOffset: 0 }] },
      timestamp: 1717900000000 + i,
    })),
  };
}

test("replay engine is embedded exactly once regardless of event count", () => {
  const html = buildReportHTML(makeReport(1000), replayAssets);
  expect(html.split("UMD_MARKER").length - 1).toBe(1);
  expect(html.split(".replayer-wrapper{}").length - 1).toBe(1);
});

test("export size grows linearly with replay events — no duplication blowup", () => {
  const s10 = buildReportHTML(makeReport(10), replayAssets).length;
  const s1000 = buildReportHTML(makeReport(1000), replayAssets).length;
  const s2000 = buildReportHTML(makeReport(2000), replayAssets).length;
  const firstThousand = s1000 - s10;
  const secondThousand = s2000 - s1000;
  // linear growth: the second thousand events cost about the same as the first
  expect(secondThousand).toBeLessThan(firstThousand * 1.2);
});

test("hostile '<' content inflates boundedly (6 bytes per '<', not exponential)", () => {
  const hostiles = "<".repeat(1000);
  const base = buildReportHTML(makeReport(2, { title: "x" }), replayAssets).length;
  const inflated = buildReportHTML(makeReport(2, { title: "x" + hostiles }), replayAssets).length;
  // each "<" becomes "<" (6 chars) in the JSON blob; allow slack for quoting
  expect(inflated - base).toBeLessThan(1000 * 6 + 200);
  // and the breakout is actually neutralised
  const html = buildReportHTML(makeReport(2, { title: "</script><script>alert(1)</script>" }), replayAssets);
  const dataBlock = html.match(/id="openjam-data" type="application\/json">([\s\S]*?)<\/script>/)[1];
  expect(dataBlock).not.toContain("</script>");
  expect(JSON.parse(dataBlock).events[0].title).toContain("</script>"); // survives round-trip
});

test("export embeds an #openjam-ai manifest before #openjam-data", () => {
  const html = buildReportHTML(makeReport(0), null);
  expect(html.indexOf('id="openjam-ai"')).toBeGreaterThan(-1);
  // manifest comes before the full data blob
  expect(html.indexOf('id="openjam-ai"')).toBeLessThan(html.indexOf('id="openjam-data"'));
  const block = html.match(/id="openjam-ai" type="application\/json">([\s\S]*?)<\/script>/)[1];
  const manifest = JSON.parse(block);
  expect(typeof manifest._doc).toBe("string");
  expect(manifest.schema).toBeDefined();
  expect(manifest.counts.console).toBe(1); // makeReport() emits one console event
});

test("hostile content in the manifest blob can't break out of its <script> tag", () => {
  const report = {
    meta: { capturedAt: 1717900000000, durationMs: 1, pageUrl: "https://t", pageTitle: "T", eventCount: 1 },
    device: { viewport: { width: 100, height: 100 } },
    events: [{ t: 1, kind: "error", title: "</script><script>alert(1)</script>", detail: { message: "boom </script><script>alert(1)</script>" } }],
    rrwebEvents: [],
  };
  const html = buildReportHTML(report, null);
  const aiBlock = html.match(/id="openjam-ai" type="application\/json">([\s\S]*?)<\/script>/)[1];
  expect(aiBlock).not.toContain("</script>");           // breakout neutralised in the manifest blob
  const manifest = JSON.parse(aiBlock);
  expect(manifest.failures[0].message).toContain("</script>"); // hostile text survives JSON round-trip
});

test("#openjam-data block is unchanged (still parseable, full events)", () => {
  const html = buildReportHTML(makeReport(0), null);
  const data = html.match(/id="openjam-data" type="application\/json">([\s\S]*?)<\/script>/)[1];
  expect(JSON.parse(data).events).toHaveLength(1);
});

test("accepts rrwebEvents as both a string and an array; #openjam-data always carries an array", () => {
  // New reports store rrwebEvents as a JSON STRING (background.js stringifies it so
  // deep DOM clears Chrome's Mojo ~100-depth cap); old/synthetic reports carry a
  // plain array. buildReportHTML must normalize both up front, because standalone
  // replay parses #openjam-data and mountReplay iterates rrwebEvents as an array.
  //
  // Disconfirming input: drop the `asEventArray` normalization in report-builder.js
  // — with a string input the embedded rrwebEvents stays a string and this fails on
  // Array.isArray (and standalone replay would break).
  const arrayReport = makeReport(3); // rrwebEvents is an array
  const stringReport = { ...arrayReport, rrwebEvents: JSON.stringify(arrayReport.rrwebEvents) };

  for (const report of [arrayReport, stringReport]) {
    const html = buildReportHTML(report, replayAssets);
    const data = html.match(/id="openjam-data" type="application\/json">([\s\S]*?)<\/script>/)[1];
    const embedded = JSON.parse(data).rrwebEvents;
    expect(Array.isArray(embedded)).toBe(true); // never a nested string
    expect(embedded).toHaveLength(3);
    expect(embedded[0].timestamp).toBe(1717900000000);
    // both inputs mount a replay (length > 1 → the engine UMD is embedded once)
    expect(html.split("UMD_MARKER").length - 1).toBe(1);
  }
});

test("inlines exactly one audio section when report.audio is present", () => {
  const html = buildReportHTML({ meta: {}, events: [], rrwebEvents: [], audio: { dataUrl: "data:audio/webm;base64,AA", mime: "audio/webm;codecs=opus", startWall: 1, durationMs: 10 } }, null);
  expect((html.match(/id="audio-section"/g) || []).length).toBe(1);
});
test("omits the audio section when report.audio is null", () => {
  const html = buildReportHTML({ meta: {}, events: [], rrwebEvents: [], audio: null }, null);
  expect(html.includes('id="audio-section"')).toBe(false);
});

test("always-injected CSS styles the standalone-audio heading", () => {
  const html = buildReportHTML({ meta: {}, events: [], rrwebEvents: [], audio: { dataUrl: "data:audio/webm;base64,AA", mime: "audio/webm;codecs=opus", startWall: 1, durationMs: 10 } }, null);
  // Standalone audio injects exactly ONE <style> (REPORT_CSS); REPLAY_CSS is absent.
  const styleBlocks = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]);
  expect(styleBlocks).toHaveLength(1);                     // guards the assumption: no REPLAY_CSS here
  expect(styleBlocks[0]).toContain("#audio-section h2{");  // CSS selector, not markup
});

test("replay export still styles the section heading after the move", () => {
  const html = buildReportHTML(makeReport(2), replayAssets);
  const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]).join("\n");
  expect(css).toContain("#audio-section h2{"); // now sourced from the always-injected REPORT_CSS
});

test("replay-only export (no audio) has no audio-section markup", () => {
  const html = buildReportHTML(makeReport(2), replayAssets); // no audio key → hasStandaloneAudio false
  expect(html.includes('id="audio-section"')).toBe(false);
});

test("no-replay export carries zero player overhead", () => {
  const withNull = buildReportHTML(makeReport(0), null);
  expect(withNull).not.toContain("UMD_MARKER");
  expect(withNull).not.toContain('id="replay-section"'); // no replay section markup (the shared #replay-section h2 CSS rule now ships always, harmlessly)
  // single-event streams don't mount a player either (nothing to play)
  const single = buildReportHTML(makeReport(1), replayAssets);
  expect(single).not.toContain("UMD_MARKER");
});
