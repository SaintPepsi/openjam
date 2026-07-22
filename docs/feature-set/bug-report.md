# Bug report export

Part of the [OpenJam feature set](README.md).

## What it does

OpenJam exports everything it captured as a **single, self-contained HTML file**
([README](../../README.md)). Open it offline and it plays back the
[session replay](session-replay.md), renders the correlated timeline of
[captured events](data-capture.md), and shows the [screenshots](screenshots.md) — no
server, no account, no internet required.

Because the report is one file with no external dependencies, it is also the unit of
sharing: it only leaves your machine if *you* send the file. See
[Privacy & data control](privacy.md).

## What to expect / limitations

- Everything is inlined, so the file size scales with session length and captured data
  (issue #44 — a real recording was 87.6 MB). The `#openjam-data` blob itself is
  gzip+base64'd (see [AI manifest](ai-manifest.md) for the decode contract); session
  replay's inlined `<img>`s may also be webp-encoded rather than lossless PNG depending
  on whether that separate fix (`src/rrweb-recorder.js`) has landed.
- The report is built locally by `report-builder.js` and rendered by `viewer.js` / `renderer.js`.

## Test data

- Report builder tests: `test/report-builder.test.js`, `test/packaging.test.js`
- e2e that builds and exports a report: `test/e2e/build-export.mjs`
- Sample exported reports you can open: `eval/out/with-manifest.html`, `eval/out/without-manifest.html`

## Related

- [AI manifest](ai-manifest.md) — the machine-readable index embedded in the report
- [Privacy & data control](privacy.md) — why one local file matters
