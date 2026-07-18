// Pure builder: derives a small, self-describing index from a captured report so
// AI agents orient (#openjam-ai) without parsing the full #openjam-data blob.
import { KINDS, LEGEND } from "./event-kinds.js";

const MESSAGE_CAP = 500;
const MAX_FAILURES = 100;

const DOC =
  "OpenJam capture. events[] in #openjam-data is sorted ascending by t (epoch ms). " +
  "Each event = {t,kind,title,detail}. failures[] indices ('i') point into that array; " +
  "at most " + MAX_FAILURES + " are listed and failuresOmitted counts any beyond that. " +
  "counts['console.error'] is a subset of counts.console, not a separate kind. " +
  "Extract #openjam-data for full event detail.";

function truncate(s) {
  if (typeof s !== "string" || s.length <= MESSAGE_CAP) return s;
  let cut = s.slice(0, MESSAGE_CAP);
  // Don't split a surrogate pair: drop a dangling lead surrogate at the boundary.
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut + "…";
}

// An event is a failure if a rule matches; `message` is the highest-signal text.
// Data-driven: a new failure kind is a new row, not a new branch.
const FAILURE_RULES = [
  {
    match: (e) => e.kind === "network" && e.detail && typeof e.detail.status === "number" && e.detail.status >= 400,
    message: (e) => e.detail.responseBody || e.detail.statusText || null,
  },
  {
    match: (e) => e.kind === "network" && e.detail && e.detail.failed,
    message: (e) => e.detail.errorText || null,
  },
  { match: (e) => e.kind === "error", message: (e) => (e.detail && e.detail.message) || e.title || null },
  {
    match: (e) => e.kind === "console" && e.level === "error",
    message: (e) => (e.detail && e.detail.message) || e.title || null,
  },
];

export function buildManifest(report) {
  const events = (report && report.events) || [];
  const counts = {};
  for (const k of KINDS) counts[k] = 0;
  let consoleErrors = 0;

  const failures = [];
  events.forEach((e, i) => {
    if (counts[e.kind] != null) counts[e.kind] += 1;
    if (e.kind === "console" && e.level === "error") consoleErrors += 1;
    const rule = FAILURE_RULES.find((r) => r.match(e));
    if (rule) {
      const entry = { i, kind: e.kind, title: e.title };
      if (e.kind === "network" && typeof e.detail?.status === "number") entry.status = e.detail.status;
      const msg = rule.message(e);
      if (msg) entry.message = truncate(msg);
      failures.push(entry);
    }
  });
  // DERIVED sub-count of `console` (not an independent kind); don't double-count when summing `counts`.
  counts["console.error"] = consoleErrors;

  // Cap the index so a pathological report can't bloat the "small" manifest;
  // counts still reflect the true totals, and failuresOmitted flags the overflow.
  const failuresOmitted = Math.max(0, failures.length - MAX_FAILURES);
  const capped = failuresOmitted ? failures.slice(0, MAX_FAILURES) : failures;

  const out = { _doc: DOC, schema: LEGEND, counts, failures: capped, failuresOmitted };
  if (report && report.audio) out.audio = { durationMs: report.audio.durationMs, mime: report.audio.mime };
  return out;
}
