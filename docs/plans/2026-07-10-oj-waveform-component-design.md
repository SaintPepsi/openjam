# `<oj-waveform>` — reusable waveform view — Design

**Date:** 2026-07-10

## Problem

The session-replay report and the landing page each render an audio waveform,
by two unrelated implementations:

- **Replay** (`renderer.js`): a `<canvas>` drawing real peaks from the captured
  narration, positioned at the clip's true offset on the replay timeline, with a
  tail tick where on-screen activity ends. Peak extraction at `renderer.js:288-298`.
- **Landing** (`docs/index.html:958-1160`, `WaveformPlayer`): DOM `<span>` bars
  scaled by a synthetic sine "speech" envelope, with an easter-egg path that
  decodes a real mp3 into peaks. A separate, cosmetic reimplementation.

The peak-extraction algorithm is duplicated (`renderer.js:288-298` ≈
`index.html:1014-1021`), and the landing page shows a mimic rather than the real
component users see in a report. Goal: one waveform component, used by both, so
the marketing page demoes the genuine article and the extraction logic has a
single home.

## Constraints

- **Self-contained, MV3-safe.** No network egress, no external runtime deps, no
  remote code. Classic-script-safe (no top-level `import`/`export`), matching
  `install-cta.js` / `openjam-popup.js`.
- **The report ships code by serializing function source.** `report-builder.js:63`
  inlines `mountReplay.toString()`. A module the replay merely *imports* never
  reaches the exported report. Any shared code must be inlined into the report as
  its own script, exactly how the rrweb engine ships (`build.mjs:115` emits it as
  a string constant that `report-builder.js` embeds).
- **Two host contexts** must both get the element: the in-extension viewer
  (`viewer.html`, ES-module `viewer.js`) and the exported self-contained report.
- **Privacy rule applies to the landing page too** (`docs/CLAUDE.md`): assets
  inline or ship as files in `docs/`.

## Approaches Considered

1. **Shared pure functions only** — extract `extractPeaks()` + `drawBars()`, no
   element; each site hand-wires canvas + interaction. Leanest, but the landing
   page re-implements orchestration and there's no drop-in for either host.
2. **Full custom element that owns everything** (peaks + canvas + interaction +
   audio playback + timeline) — maximum surface, but it would have to absorb
   replay-only concerns (timeline offset, tail tick, `AudioBufferSourceNode`
   playback, gain/mute, the clock). That is false-sharing: the landing page needs
   none of it, and the element becomes a fat god-object.
3. **Full custom element as a pure view** (chosen) — the element owns extraction,
   canvas render, and click→event, and *nothing* about audio, the clock, or the
   timeline. `ui = fn(state)`. Each parent keeps its own playback/clock and feeds
   the element state.

## Chosen Approach

Approach 3. A vanilla custom element `<oj-waveform>` that is a pure view:

```
state in ─────────────► <oj-waveform> ──────────────► event out
  el.samples: Float32Array (one channel, the shape)     "oj-seek"
  el.progress: 0..1        (how far it's played)          { detail: { fraction } }
  el.bars?: number         (resolution; auto from width)
```

The element owns: peak extraction (pure, memoized from `samples`, re-extracted on
resize), canvas render (DPR-aware, colours read from `--accent` / `--muted`
computed style), and click → `oj-seek`. It owns nothing else — no timer, no
`requestAnimationFrame`, no clock, no audio, no "should I render?" gate.

## Architecture

### The element (`waveform.js`, repo root)

```js
class OjWaveform extends HTMLElement {
  static extractPeaks(samples, bars) { /* pure: normalized 0..1 peaks[] */ }

  set samples(v)  { this._samples = v; this._peaks = null; this.render(); }
  set progress(v) { this._progress = v; this.render(); }   // 0..1

  render() {   // pure fn of (this._samples, this._progress, size). no clock, no globals.
    if (!this._peaks) this._peaks = OjWaveform.extractPeaks(this._samples, this._barCount());
    drawBars(this.ctx, this._peaks, this._progress, this._colors());
  }
  // connectedCallback: build canvas, ResizeObserver → clear _peaks + render, click → oj-seek
}
```

- `_peaks` is a memoized derivation of `samples` (not a second source of truth).
- Classic-script-safe; guarded `customElements.define`; guarded
  `module.exports = { OjWaveform, extractPeaks }` for bun tests. Same shape as
  `install-cta.js`.

### Delivery to both hosts

- **Landing page**: `build.mjs` splices `waveform.js` into `docs/index.html`
  between `<!-- oj-waveform:start -->` / `<!-- oj-waveform:end -->` as a
  `<script>`, exactly like `install-cta` (`build.mjs:63-66`).
- **Exported report**: `build.mjs` emits `WAVEFORM_JS` (the source string) into
  `src/generated/player-assets.js`; `report-builder.js` inlines
  `<script>${WAVEFORM_JS}</script>` *before* the `mountReplay` block, so the
  element is registered when `mountReplay` runs. `mountReplay` only ever does
  `document.createElement("oj-waveform")` — no global reference, no closure capture.
- **In-extension viewer**: `viewer.html` adds `<script src="waveform.js"></script>`
  before `viewer.js`.

## Data Model

The element's state is `{ samples: Float32Array, progress: number 0..1 }`.
`bars` is optional (derived from element width when unset). Peaks are derived, not
stored input. No shared type file is needed — the contract is two setters and one
event.

## Data Flow (parents own audio + clock)

There is one clock (the renderer's `curTime()`), and the waveform is a derived
view of it — never synced *to* it.

- **Replay** (`renderer.js`): on decode → `waveEl.samples = buf.getChannelData(0)`.
  In `paint()` (`renderer.js:402`), replace `drawWave(frac)` with a clip-relative
  push:

  ```js
  var clipStart = audioStart - replayStart;              // ms of clip on the timeline
  var clipDur   = Math.round(audioBuf.duration * 1000);
  waveEl.progress = clipDur ? Math.max(0, Math.min(1, (curTime() - clipStart) / clipDur)) : 0;
  ```

  This is the same relationship `syncAudio` already computes for playback
  (`renderer.js:379`). On `oj-seek` → `seek(clipStart + e.detail.fraction * clipDur)`.
  Replay keeps its `AudioBufferSourceNode`, gain/mute, and the scrub bar as the
  full-timeline control.
- **Landing** (`docs/index.html`): decode the existing
  `ah-shit-here-we-go-again.mp3` → `samples`; a play button + clock drive
  `progress`; `oj-seek` seeks the clip. The synthetic sine-envelope + oscillator
  mumble (`index.html:968-1077`) is **deleted**.

## Error Handling

- No Web Audio / decode failure: element left without `samples` renders an empty
  strip (fail-open, as the replay does today, `renderer.js:271`).
- `progress` out of range is clamped by the parent before it's set; the element
  also clamps defensively in `render()`.
- Report inlining keeps the existing `</script`-neutralising guard applied to
  inlined scripts (`build.mjs:59`, `report-builder.js:37`).

## Testing Strategy

- **Unit (bun)**: `OjWaveform.extractPeaks` — pure, deterministic. Feed a known
  `Float32Array`, assert the normalized peaks (incl. a disconfirming case: a
  silent buffer → all-zero peaks, and a single loud sample → one bar at 1).
- **Single-source test**: assert the spliced `<oj-waveform>` block in
  `docs/index.html` byte-matches `waveform.js`, mirroring
  `test/popup-source-of-truth.test.js`, so a hand-pasted copy can't drift.
- **e2e (playwright)**: the report renders an `<oj-waveform>`, its `progress`
  advances while playing, and a click on the strip seeks (landing-page structure
  test already exercises the narrated-repro block, `e2e/landing-page-structure.spec.mjs`).

## Principles Applied

- **UI = fn(state)** — `render()` is a pure function of `{samples, progress}`;
  the element emits `oj-seek` and mutates nothing outside itself. Property setters
  are the delivery mechanism (no reactive runtime in vanilla custom elements); the
  determinism guarantee is unchanged.
- **Single Source of Truth** — one `extractPeaks` replaces the two duplicated
  copies; the element source has one authored home spliced/inlined everywhere.
- **Separation of Concerns** — view (element) vs. playback + clock + timeline
  (each parent). The renderer keeps the one clock; the element mirrors it.
- **Unify Shared Interfaces without false-sharing** — the timeline offset and
  tail tick stay in the replay parent rather than being pushed into a generic
  element (avoids the Approach 2 god-object).

## Behavior Change (called out)

Today the replay waveform is a **timeline view**: bars sit at the clip's offset
inside the longer total duration, with a tail tick (`renderer.js:335-349`). As a
pure-view element it becomes a **clip view**: bars fill the strip = the narration
clip; playhead = progress through the clip; during the narration tail `progress`
clamps to 1 (playhead rests at the right edge) in place of the tail tick. The
scrub bar above remains the full-timeline control. This matches the requested
model ("just shows the shape and where it's played up to; click fires a
callback") and is intended, not a regression.

## Open Questions

- Unplayed-bar colour: keep today's literal `#3b414d` (`renderer.js:343`) or move
  it to a token? Leaning token for consistency, but it has no other consumer today.
- `bars` resolution on the landing page: match the replay's `width/3` clamp
  (60–600) or keep a lower fixed count for the smaller strip? Default to the same
  width-derived rule for visual parity.
