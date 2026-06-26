# Screenshots

Part of the [OpenJam feature set](README.md).

## What it does

OpenJam captures screenshots via the CDP `Page.captureScreenshot` domain
([README → How it works](../../README.md#how-it-works)):

- at recording **start and stop**,
- automatically **on every error**,
- and **on demand** while recording.

Each screenshot is placed on the same wall-clock timeline as every other event, so you can
see the visual state at the moment something failed.

## What to expect / limitations

- Screenshots are bitmaps embedded in the report — unlike the [session replay](session-replay.md)
  (reconstructed DOM), they are exact pixels of what was on screen.

## Test data

- Generated product screenshots (driven over the e2e fixture): `docs/screenshots/`
- Screenshot generation script: `scripts/screenshots.mjs`

## Related

- [Session replay](session-replay.md) — the moving picture vs. these stills
- [Bug report export](bug-report.md) — how screenshots are packaged
