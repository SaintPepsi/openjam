# OpenJam AI Manifest — Design

**Date:** 2026-06-16

## Problem

OpenJam reports are self-contained HTML bundles consumed increasingly by AI agents
(e.g. Claude Code) to triage bugs and recreate tests/repros. The full capture is
*already* embedded as clean JSON in `<script id="openjam-data">` and the `events[]`
array is already a single timeline sorted ascending by wall-clock `t`. But an agent
opening the file has no map: it doesn't know the schema, doesn't know the array is
pre-sorted, and must scan every event (230+ in real captures, with response bodies +
rrweb frames inflating the blob to multiple MB) just to find the one request that
failed. Observed in practice: an agent grepped the raw HTML with repeated shell
commands to locate a single `PATCH /diaries/5` 400 — work the report should hand it.

Goal: embed a small, self-describing **manifest** that lets an AI orient instantly and
jump straight to what broke, without parsing the full payload.

## Constraints

- **Stay self-contained.** No external CLI/MCP/sidecar files. Everything lives inside
  the single exported HTML. (Matches OpenJam's offline, no-backend ethos.)
- **Don't change the existing `#openjam-data` contract.** The viewer reads it; leave it.
- Plain JS, no TypeScript (project convention). Tests are `node --test` style.
- Keep it small — the manifest's value is being cheap to read relative to the full blob.

## Approaches Considered

1. **Separate top-placed manifest block** — a new
   `<script id="openjam-ai" type="application/json">` emitted *before* `#openjam-data`,
   built by a pure `buildManifest(report)`. Agent reads ~1 KB to orient, then extracts
   only the events it needs by index. *Principle fit:* clean separation, pure/testable.
   *Tradeoff:* two blocks must stay index-consistent — mitigated because both derive
   from the same sorted `report` at build time.

2. **`manifest` key inside `#openjam-data`** — same content, nested in the existing
   blob. Simplest plumbing, one block. *Tradeoff:* to read the index the agent must load
   the entire multi-MB payload, defeating the cheap-orientation win that motivates the
   feature.

3. **Markdown/prose manifest** — a readable summary block instead of JSON. Doubles as
   human doc. *Tradeoff:* not a stable machine contract; pointers/indices are awkward in
   prose and an agent loop can't rely on the shape. Violates the stable-schema goal.

## Chosen Approach

**Approach 1.** It delivers the core benefit — orient cheaply, then drill in by index —
while staying a stable machine contract and cleanly testable. The index-consistency
tradeoff is a non-issue since the manifest and the data blob are computed from the same
sorted report in one build pass.

## Architecture

- **`manifest.js`** (new) — exports a pure `buildManifest(report)` returning the manifest
  object. No I/O, no side effects.
- **`event-kinds.js`** (new) — single source of truth for event `kind`s and their legend
  strings. Imported by `manifest.js`; `background.js` kind literals reconciled against it.
- **`report-builder.js`** (orchestrates) — calls `buildManifest(report)`, embeds the
  result as a second `<script id="openjam-ai" type="application/json">` placed *before*
  `#openjam-data`. Same `<`-escaping as the existing blob. No logic beyond wiring.

Data flow: `report` (from background.js, already sorted) → `buildManifest(report)` →
manifest object → JSON-escaped → embedded as `#openjam-ai` → `#openjam-data` unchanged.

## Data Model

`#openjam-ai` manifest:

```json
{
  "_doc": "OpenJam capture. events[] in #openjam-data is sorted ascending by t (epoch ms). Each event = {t,kind,title,detail}. Indices ('i') below point into that array. Extract #openjam-data for full event detail.",
  "schema": {
    "network": "detail: method,url,status,statusText,requestHeaders,requestBody,responseHeaders,responseBody,durationMs,encodedBytes,failed,errorText",
    "console": "detail: message,stack; level: log|info|warning|error|debug",
    "error":   "detail: message,url,line,column,stack",
    "log":     "detail: message,url,source",
    "screenshot": "detail: dataUrl/error; title labels the moment"
  },
  "counts": { "network": 167, "console": 12, "error": 1, "console.error": 3 },
  "failures": [
    {
      "i": 142,
      "kind": "network",
      "status": 400,
      "title": "PATCH /diaries/5",
      "message": "Cannot save changes for 2026-06-19: the day cannot be made unavailable..."
    }
  ]
}
```

**Failure detection (data-driven rule table)** — an event is a failure if any rule matches:

| Rule | Condition | `message` source |
|---|---|---|
| HTTP error | `kind==="network" && detail.status >= 400` | `detail.responseBody` (truncated) or `statusText` |
| Network failure | `kind==="network" && detail.failed` | `detail.errorText` |
| Thrown error | `kind==="error"` | `detail.message` |
| Console error | `kind==="console" && level==="error"` | `detail.message` |

`failures[].i` is the index into the sorted `events[]`. `message` is truncated to a sane
cap (e.g. 500 chars) to keep the manifest small.

## Error Handling

- `buildManifest` tolerates missing/empty `events`, missing `detail`, absent
  `responseBody` — returns zeroed counts and `failures: []` rather than throwing.
- Embedding reuses the existing `<`→`<` escape so the manifest JSON can't break out
  of its `<script>` tag.
- If `buildManifest` somehow throws, export must not fail — wrap the call and embed an
  empty/degraded manifest rather than aborting the report.

## Testing Strategy

- **Unit (`test/manifest.test.js`)** — feed a synthetic report with mixed kinds, a 400
  with a response body, a thrown error, and a `console.error`; assert: `counts` per kind,
  `failures[]` length + correct `i` indices + `message` extraction + truncation, and that
  `schema` covers every kind present.
- **Integration (extend `test/report-builder.test.js`)** — assert `#openjam-ai` block is
  present, parses as JSON, sits before `#openjam-data`, and that `#openjam-data` is
  unchanged.
- **Edge** — empty report → valid manifest with zero counts and empty failures.

## Principles Applied

- **Pure Functions for Testability** — `buildManifest(report)` is pure: input report,
  output manifest, no I/O. Trivially unit-tested.
- **Data Drives Behavior** — failure detection is a rule table and the kind legend is
  data, not scattered `if (url === ...)` branches. New failure kinds = new rows.
- **Single Source of Truth** — `event-kinds.js` centralizes the `kind` set + legend;
  `background.js` and `manifest.js` reconcile against it instead of duplicating literals.
- **Separation of Concerns** — compute (`manifest.js`) vs. embed (`report-builder.js`)
  vs. render (viewer, untouched) stay distinct.
- **Deviations** — none.

## Open Questions

- Should the live viewer also surface the manifest (a "what broke" panel), or is the
  embedded block export-only for now? Leaning export-only (YAGNI) — revisit if useful.
- `message` truncation cap: 500 chars assumed; confirm during implementation.
