# issue-34 — inline blob:-sourced images in the recorder — Design

**Date:** 2026-07-16

## Problem

Pages that render images from `blob:` object URLs (Atlassian Media attachments,
or any app using `URL.createObjectURL`) export with broken images. rrweb's
`record()` is called without `inlineImages`, so `<img>` nodes are serialised with
their original `src` untouched. A `blob:` URL is scoped to the originating
document; the moment the self-contained report opens as a standalone file, every
`blob:` `src` resolves to nothing and the image renders broken.

Fix: pass `inlineImages: true` to `record()` so images are drawn to an offscreen
canvas and embedded as `data:` URIs at record time. Confirmed mechanism
(`node_modules/rrweb/dist/rrweb.js:1060-1097`): rrweb reads pixels from the
already-loaded `<img>` via `canvas.toDataURL()` — it does **not** re-fetch over
the network, so this stays inside OpenJam's local-only privacy model.

## Constraints

- **Privacy / local-only** (root `CLAUDE.md`): no new network egress, no external
  runtime deps. `inlineImages` primary path is a canvas pixel-read, not a fetch.
  The one exception is the CORS-taint retry (`crossOrigin="anonymous"` re-request)
  — out of scope here because `blob:` URLs inherit the document origin and never
  taint the canvas, so they hit the fast path.
- **Storage size:** inlined bytes grow the report. The manifest already has
  `unlimitedStorage` (`manifest.json:6`), so the `chrome.storage.local` ~10 MB
  quota backstop is lifted; the existing "report exceeded storage quota"
  degradation path (`background.js:515`) is not newly at risk. The exported HTML
  file grows, but self-containment is the whole point.
- **Must not regress:** the CSP-egress test (`e2e/extension.spec.mjs:183-230`)
  and the offline-replay test (`:155-181`) must keep passing. Inlining doesn't
  touch CSP.
- **Immutable baseline:** the two ACs in `docs/tickets/issue-34.md`.

## Approaches Considered

### The fix (one real option)

1. **`inlineImages: true`, default `dataURLOptions` (PNG) — RECOMMENDED.** Add
   the flag alongside `emit` in the existing `record({...})` literal. PNG is
   lossless (correct fidelity, preserves transparency). No size tuning now.
2. **`inlineImages: true` + `dataURLOptions: { type: "image/jpeg", quality }`.**
   Smaller files for photographic content, but lossy, drops alpha, and adds a
   knob with no evidence it's needed. `unlimitedStorage` removes the pressure
   that would justify it. Violates YAGNI.
3. **Leave broken / post-process images in `background.js`.** Rejected: builds a
   bespoke image pipeline when a supported one-flag path exists (adds a whole
   concern, violates "removing beats adding").

Recommendation: option 1. Add a one-line comment noting `dataURLOptions` is the
size knob if real reports prove too large — a reversible fast-follow.

### How to introduce the `blob:` image under test

The bug needs an `<img>` whose `src` is a `blob:` URL, loaded before the snapshot.
The source of the blob bytes is irrelevant to the bug; the `src` scheme is what
matters.

- **A. Synthesize the blob image in the spec — RECOMMENDED.** Extend
  `recordSession()` with an opt-in `blobImage` step that, before `start`, uses
  `page.evaluate` to `fetch(<inline data: PNG>) → blob → URL.createObjectURL`,
  appends `<img>`, and awaits `naturalWidth > 0`; it returns the blob URL. No
  `fixture.html` edit, no harness route change. Faithful repro (the page does
  exactly what Atlassian Media does). This is page setup, not re-implementing
  production logic — the recorder still does the real inlining.
- **B. Add a `blob:` `<img>` to the shared `fixture.html`.** Perturbs the five
  other e2e tests *and* `scripts/screenshots.mjs` (both drive the same fixture),
  forcing screenshot regeneration for an unrelated change. Rejected on
  separation-of-concerns.
- **C. Dedicated fixture file + a second `serveFixture` route.** Clean isolation
  but requires harness surgery (`serveFixture` serves exactly one file today,
  `harness.mjs:46-51`). More surface than A for no extra fidelity.

Recommendation: option A.

## Chosen Approach

1. **Source fix** — `src/rrweb-recorder.js:36`: add `inlineImages: true` to the
   `record({...})` object literal, with a short `why` comment (blob:/cross-origin
   `src`s are dead outside the origin tab; inline the bytes as `data:`). Rebuild
   (`node build.mjs`) so `dist/rrweb-recorder.js` carries the flag.
2. **Unit guard** — `test/recorder.test.js`: capture the full `opts` object in the
   rrweb mock (not just `opts.emit`) and assert `opts.inlineImages === true`.
3. **E2e acceptance** — a new test in `e2e/extension.spec.mjs` extending the
   offline-replay pattern (`:155-181`) with the `blobImage` recordSession step.

## Architecture / Data Flow

No pipeline change. `inlineImages` populates an `rr_dataURL` attribute on `<img>`
snapshot nodes; everything downstream (`emit → relay → background → storage →
report-builder → renderer/Replayer`) is already agnostic to whether `rr_dataURL`
is set (discovery §4). The Replayer rebuilds the `<img>` from `rr_dataURL`.

**Load-bearing detail — the original `src` is retained, not replaced.** On record
(`rrweb.js:1074`) rrweb *adds* `attributes.rr_dataURL` and leaves
`attributes.src="blob:..."` in place (contrast the iframe path at `:1123-1127`
which deletes `src`). On replay (`rrweb.js:5532-5540`), the Replayer sets
`image.src = rr_dataURL` (the `data:` URI) and stashes the original blob URL in
`rrweb-original-src`. Consequences:
- The **rendered** replay `<img>` sources from `data:` and renders offline. ✔
- The **raw exported JSON still contains the `blob:` string** (in `attributes.src`
  and `rrweb-original-src`), and the CSP meta also literally contains `blob:`
  (`report-builder.js:51`). So a naive "export string contains no `blob:`"
  assertion **false-fails even with the fix**. AC1 must be asserted on the
  rendered replay image, not the raw string.

## Error Handling

Rely on rrweb's built-in fallbacks; add nothing.
- **Not-yet-loaded image:** rrweb inlines on the native `load` event if the image
  isn't `complete` at snapshot time. The test sidesteps the race by awaiting
  `naturalWidth > 0` before `start`, so it deterministically exercises the
  synchronous fast path. No production change needed.
- **CORS taint:** not reachable for `blob:` (same-origin). For cross-origin media
  rrweb retries once with `crossOrigin="anonymous"` then falls back to the
  untouched `src` with a `console.warn` — graceful, per-image, out of scope here.

## Testing Strategy

**Unit (`test/recorder.test.js`)** — durable CI causal guard.
- Capture full `opts`; assert `opts.inlineImages === true`.
- Disconfirming input: flip the source flag to `false` → this test goes red under
  `bun test`. This is the deterministic, in-CI proof that "the flag is what closes
  it" at the source-of-truth layer.

**E2e (`e2e/extension.spec.mjs`)** — real end-to-end acceptance (AC1).
- Extend `recordSession()` with a `blobImage` option (approach A) that appends a
  loaded `blob:` `<img>` before `start` and returns the blob URL.
- Record → stop → open viewer → download export (reusing the `:155-181` flow).
- Close the fixture server (fully offline), open the export from disk.
- Assert on the replay iframe `<img>` (user-visible outcome, per `e2e/CLAUDE.md`):
  - `img.naturalWidth > 0` — it renders, no "Failed to load image".
  - effective `img.src` starts with `data:` (Replayer swapped in `rr_dataURL`) —
    i.e. no dead `blob:` sources the image. Optionally assert
    `rrweb-original-src` equals the captured blob URL to show the swap happened.
- Disconfirming input (AC2), named in a comment per `e2e/CLAUDE.md`, confirmed
  once by hand: remove `inlineImages: true` from `src/rrweb-recorder.js`,
  rebuild → the replay `<img>` keeps `src="blob:..."`, `naturalWidth === 0`, image
  broken. This mirrors the waveform test's established comment-plus-one-run
  disconfirming pattern (`e2e/extension.spec.mjs:130-133`).

**Why the disconfirming split (unit inline vs e2e manual):** the built
`dist/rrweb-recorder.js` carries a single `inlineImages` setting, so an e2e can't
toggle it two ways without a rebuild. The unit test is therefore the durable,
automated causal lever; the e2e negative is inherently a one-time manual
confirmation (the repo's accepted convention). Together they satisfy AC2 durably
without a flaky runtime toggle. Rejected alternative: hand-building two
`buildReportHTML` payloads (with/without `rr_dataURL`) — that tests the Replayer,
not our flag, and re-implements the rrweb payload against `e2e/CLAUDE.md`.

## Principles Applied

- **Single Source of Truth** — the fix lives at the one place image bytes enter
  the pipeline (the `record()` call). No downstream code learns about images;
  everything already reads `rr_dataURL`. The unit test asserts the source flag,
  so the source stays the single truth the guard watches.
- **Data Drives Behavior** — behavior changes by setting one option value, not by
  adding image-handling branches. No `if (src.startsWith("blob:"))` special-case.
- **Separation of Concerns** — the blob image is introduced as test/page setup
  (approach A), keeping the recorder unchanged and not perturbing unrelated tests
  or the screenshot generator that share `fixture.html`.
- **Assert the user-visible outcome** (`e2e/CLAUDE.md`) — AC1 is checked on the
  rendered replay image (`naturalWidth`, effective `src`), not on a raw-string
  scan that the retained `blob:` attribute and the CSP meta would defeat.
- **YAGNI / removing beats adding** — default `dataURLOptions` (PNG), no size
  tuning, no bespoke image handling. `unlimitedStorage` removes the only pressure
  that would justify the JPEG knob.
- **Deviations:** none. The only judgment call is the AC2 unit-vs-e2e disconfirming
  split, justified above by the single-build constraint and matching repo
  precedent.

## Open Questions

1. **AC1 wording "no `blob:` `src` left in the serialised DOM."** rrweb keeps the
   original `src="blob:..."` attribute (and adds `rrweb-original-src`) in the raw
   snapshot; only the *rendered* effective `src` becomes `data:`. Broadest
   reasonable interpretation, and the one this design assumes: AC1 means the image
   no longer *renders from* a dead `blob:` — assert the replay img's effective
   `src` is `data:` and it renders. Confirm this reading, or the orchestrator
   should decide whether the ticket instead wants the raw `blob:` attribute
   stripped (would require a post-record transform — larger scope).
2. **`dataURLOptions` at ship.** Recommend default PNG now given `unlimitedStorage`.
   Confirm no size cap on the export path makes JPEG necessary at ship (discovery
   §7 left the export-size-check question untraced); if it is, it's a one-line
   fast-follow, not a blocker.
</content>
</invoke>
