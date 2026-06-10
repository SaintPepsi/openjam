// E2E helper: builds a self-contained OpenJam export from a JSON file of REAL
// rrweb events (recorded in a live browser), so the replay path can be
// verified end-to-end. Usage:
//   node test/e2e/build-export.mjs <events.json> <out.html>
import { readFileSync, writeFileSync } from "node:fs";
import { buildReportHTML } from "../../report-builder.js";
import * as replayAssets from "../../src/generated/player-assets.js";

const [eventsPath, outPath] = process.argv.slice(2);
const rrwebEvents = JSON.parse(readFileSync(eventsPath, "utf8"));
if (!Array.isArray(rrwebEvents) || rrwebEvents.length < 2) {
  throw new Error("expected an array of >=2 rrweb events, got " + rrwebEvents.length);
}

const t0 = rrwebEvents[0].timestamp;
const report = {
  meta: {
    version: "0.2.0",
    capturedAt: t0,
    durationMs: rrwebEvents[rrwebEvents.length - 1].timestamp - t0,
    pageUrl: "fixture",
    pageTitle: "OpenJam E2E Fixture",
    eventCount: 1,
  },
  device: { userAgent: "e2e", viewport: { width: 1280, height: 720 } },
  events: [
    { id: 1, t: t0, rel: 0, kind: "console", level: "log", title: "e2e capture", detail: { message: "e2e capture" } },
  ],
  rrwebEvents,
};

writeFileSync(outPath, buildReportHTML(report, replayAssets));
console.log("wrote", outPath, "with", rrwebEvents.length, "rrweb events");
