# AI manifest

Part of the [OpenJam feature set](README.md).

## What it does

Each report embeds a small `<script id="openjam-ai" type="application/json">` manifest
*before* the full `<script id="openjam-data">` blob
([README → For AI agents](../../README.md#for-ai-agents)). The manifest carries:

- a `_doc` description,
- a per-kind `schema` legend,
- `counts`,
- and a `failures[]` index whose `i` fields point into the sorted `events[]` array in
  `#openjam-data`.

An AI agent reads the manifest first to orient, then extracts only the events it needs by
index — no need to parse the whole blob. This makes reports fast and cheap for agents to
diagnose.

## What to expect / limitations

- The manifest is an index/legend, not a second copy of the data — the events live in
  `#openjam-data`.
- `#openjam-data` is gzip+base64 (`type="application/gzip;base64"`, issue #44 — shrinks
  the dominant contributor to export size), not plain JSON. Don't `JSON.parse` it. The
  export inlines a decoder as the global `OJCodec`: `OJCodec.decodeOjData(text)`. Outside
  a browser, the same function ships at `src/generated/codec.js` (built by `build.mjs`).

## Test data

- Manifest structure tests: `test/manifest.test.js`, `test/manifest-eval.test.js`
- A/B eval measuring whether the manifest helps an agent find the failure faster:
  `eval/README.md`, `eval/run-eval.mjs` (reports: `eval/out/with-manifest.html` vs
  `eval/out/without-manifest.html`)

## Related

- [Data capture](data-capture.md) — the events the manifest indexes
- [Bug report export](bug-report.md) — where the manifest is embedded
