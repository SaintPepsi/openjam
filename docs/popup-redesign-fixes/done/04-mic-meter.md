# 04 — Wire or gate the mic level meter

Depends on: [00-epic](../00-epic.md), [05](05-component-source-of-truth.md), [05b](05b-render-from-state.md)

## Problem

The component shows a live level meter plus a "listening…" hint whenever
recording with mic on, and `setMicLevel` exists to feed it — but nothing in the
extension ever calls it. The wiring exists only as a commented-out sketch
(`popup.js:101`). A user recording narration sees a permanently flat meter under
"listening…" and reasonably concludes their mic isn't captured.

Cost on top: the meter's `requestAnimationFrame` loop runs unconditionally for
the component's lifetime (`openjam-popup.js:336`, `_loop`), rewriting
transform/opacity on 40 bars even when nothing changes — every open popup burns
~60 wakeups/sec.

## Decision (Ian, 2026-07-09)

Gate, don't wire. Mic capture already works end to end — narration records to
the report and the replay exposes a volume control
(`test/e2e/audio.spec.mjs`: "audio-enabled recording writes report.audio with a
webm data URL", "replay player with audio renders a waveform, volume control").
The level meter is only a live *input-level* animation, separate from capture,
and wiring a real feed is not worth it right now. So hide the meter in the live
popup rather than feed it; a follow-up can wire it if the reassurance is ever
wanted.

## Fix

Gate the meter row and the "listening…" hint behind the `[demo]` attribute: the
marketing demo keeps its synthetic animation, the live extension popup shows
neither (no permanently flat meter reading as "mic dead"). Mic toggle + device
picker are unaffected. Because 05b landed, flow the visibility through
`_render` / `:host` state, not an imperative poke. Start the `_loop` rAF only
when the meter can animate (i.e. `[demo]`); it must not run in the live popup.

Do **not** wire the offscreen feed or uncomment the `popup.js:101` listener —
that is the deferred follow-up, out of scope here.

## Acceptance criteria

- Meter gated to demo: e2e asserts the meter row has zero bounding-box height in
  the live extension popup while recording with mic on, and non-zero height with
  the `[demo]` attribute set (assert height, not presence — collapsed shadow
  content still passes visibility checks, per `e2e/CLAUDE.md`). Command + passing
  output in the PR.
- Disconfirming input: remove the `[demo]` gate (show the meter in live) → the
  zero-height assertion fails. Paste the failing output.
- rAF check: with the live popup open and recording with mic on, no per-frame
  style writes occur (the `_loop` rAF is not running) — cite the guard as
  `file:line` in the PR.
- No feed wired: `grep -n "micLevel" popup.js` shows the listener still
  commented, confirming input capture was left for the follow-up.
