// Pure builder: derives a small, self-describing index from a captured report so
// AI agents orient (#openjam-ai) without parsing the full #openjam-data blob.
import { KINDS, LEGEND } from "./event-kinds.js";

const DOC =
  "OpenJam capture. events[] in #openjam-data is sorted ascending by t (epoch ms). " +
  "Each event = {t,kind,title,detail}. Indices ('i') below point into that array. " +
  "Extract #openjam-data for full event detail.";

export function buildManifest(report) {
  const events = (report && report.events) || [];
  const counts = {};
  for (const k of KINDS) counts[k] = 0;
  let consoleErrors = 0;

  for (const e of events) {
    if (counts[e.kind] != null) counts[e.kind] += 1;
    if (e.kind === "console" && e.level === "error") consoleErrors += 1;
  }
  counts["console.error"] = consoleErrors;

  return { _doc: DOC, schema: LEGEND, counts, failures: [] };
}
