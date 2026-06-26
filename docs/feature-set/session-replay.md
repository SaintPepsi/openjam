# Session replay

Part of the [OpenJam feature set](README.md).

## What it does

OpenJam records a full **DOM session replay** of the page using
[rrweb](https://github.com/rrweb-io/rrweb) (bundled into the extension; see
[README → Build](../../README.md#build-required-once)). Instead of a video, it captures
the DOM and its mutations over time, so the exported report can *play back* exactly what
the page looked like and how it changed — and you can scrub the timeline.

Replay is correlated with every other captured event on one wall-clock timeline, so a
console error or failed request lines up with what was on screen at that moment.

## What to expect / limitations

- Replay reconstructs the DOM — it is not a pixel-perfect video. Cross-origin iframes,
  `<canvas>`/video content, and some media may not reproduce faithfully.
- Replay assets are bundled so the report plays back **offline** (`src/generated/player-assets.js`).
- Large or long sessions produce larger report files.

## Test data

- Deterministic e2e fixture the replay is exercised against: `test/e2e/fixture.html`
- Replay/recorder unit tests: `test/recorder.test.js`, `test/relay.test.js`
- Sample exported reports with replay embedded: `eval/out/with-manifest.html`

## Related

- [Bug report export](bug-report.md) — how the replay is packaged into one file
- [Screenshots](screenshots.md) — still captures alongside the replay
