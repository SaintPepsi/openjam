# 04 — Wire or gate the mic level meter

Depends on: [00-epic](00-epic.md)

## Problem

The component shows a live level meter plus a "listening…" hint whenever
recording with mic on, and `setMicLevel` exists to feed it — but nothing in the
extension ever calls it. The wiring exists only as a commented-out sketch
(`popup.js:101`). A user recording narration sees a permanently flat meter under
"listening…" and reasonably concludes their mic isn't captured.

Cost on top: the meter's `requestAnimationFrame` loop runs unconditionally for
the component's lifetime (`openjam-popup.js:315`), rewriting transform/opacity
on 40 bars even when nothing changes — every open popup burns ~60 wakeups/sec.

## Fix

Either wire it (emit rms from the offscreen capture path as a `micLevel`
message and uncomment the `popup.js:101` listener), or gate the meter row and
hint behind the `[demo]` attribute until a real feed exists. Both ways: start
the rAF loop only when the meter is visible and data is arriving, stop it
otherwise.

## Acceptance criteria

- If wired: e2e with `--use-fake-device-for-media-stream` (already used by
  `scripts/screenshots.mjs:40-43`), record with mic on, assert at least one
  meter bar mutates its style within 2s. Command + passing output in the PR.
- If gated: e2e asserts the meter row is absent in the extension popup while
  recording with mic on, and present on the landing demo.
- Disconfirming input: sever the feed (or remove the gate) → the test fails.
- rAF check: with the popup open and idle, no per-frame style writes — cite the
  guard added around `openjam-popup.js:315` as `file:line` in the PR.
