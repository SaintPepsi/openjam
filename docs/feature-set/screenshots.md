# Screenshots

Part of the [OpenJam feature set](README.md).

## What it does

OpenJam captures screenshots via the CDP `Page.captureScreenshot` domain
([README → How it works](../../README.md#how-it-works)):

- at recording **start and stop**,
- automatically **on every error**.

Each screenshot is placed on the same wall-clock timeline as every other event, so you can
see the visual state at the moment something failed.

## What to expect / limitations

- Screenshots are bitmaps embedded in the report — unlike the [session replay](session-replay.md)
  (reconstructed DOM), they are exact pixels of what was on screen.
- In [reduced mode](data-capture.md#when-chromes-debugger-is-unavailable-reduced-mode) (no
  debugger) screenshots come from `chrome.tabs.captureVisibleTab`: the visible viewport of
  the recorded tab, and only while that tab is the active one in its window. A screenshot
  that could not be taken is recorded on the timeline as `… (failed)` with the reason.

## Test data

- Generated product screenshots (driven over the e2e fixture): `docs/screenshots/`
- Screenshot generation script: `scripts/screenshots.mjs`

## Related

- [Session replay](session-replay.md) — the moving picture vs. these stills
- [Bug report export](bug-report.md) — how screenshots are packaged
