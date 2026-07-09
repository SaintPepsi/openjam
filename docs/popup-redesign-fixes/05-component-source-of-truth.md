# 05 — Single source for the popup component + tokens

Depends on: [00-epic](00-epic.md)

Predecessor of [01](01-toggle-reentrancy.md), [02](02-screenshot-button.md),
[03](03-mic-state.md), [04](04-mic-meter.md), [06](06-demo-toggle.md) — every
ticket that edits `openjam-popup.js`. Landing 05 first means each of those edits
one file, not two.

## Problem

`docs/index.html:531` carries a full ~430-line pasted copy of
`openjam-popup.js`, and *both* copies claim to be "One source of truth"
(`openjam-popup.js:4`, `docs/index.html:536`). Every component fix must be
re-pasted by hand or the marketing demo drifts from the shipped popup — the
inert demo-stop bug ([06](06-demo-toggle.md)) already ships byte-identical in
both copies.

Dead code from the pre-component landing page also survived the redesign:

- `WaveformPlayer({ waveId:"heroWave", playId:"heroPlay", captionId:"heroCaption", ... })`
  at `docs/index.html:1232` plus its `heroWords` timing data — no element with
  those ids exists, so the constructor's null guard silently no-ops.
- The `#tiltCard` tilt IIFE at `docs/index.html:1241` — same missing-element
  no-op, and it duplicates the live tilt math in `openjam-popup.js:400`
  (`_startTilt`), so the next tilt tweak plausibly lands in the copy that does
  nothing.
- ~100 lines of CSS for removed markup: `.popup`/`.prow`/`.microw`
  (`docs/index.html:118-139`), the old report/waveform card block, and the
  proof/testimonial grid (`docs/index.html:262-278`) — none of these classes
  appear in the body.

Design tokens are quadruplicated on top of this: the palette lives in the
component `:host`, `renderer.js` REPORT_CSS, `viewer.html`, and the landing
`:root`. A palette change today is four edits, or silent drift between the
popup, the report, and the viewer.

## Fix

`build.mjs` already bundles rrweb (repo `CLAUDE.md`, Tests & CI section). Add a
step that splices `openjam-popup.js` into `docs/index.html` between markers
(e.g. `<!-- openjam-popup:start/end -->`), and delete the pasted copy, the dead
hero wiring, `heroWords`, the tilt IIFE, and the orphaned CSS blocks.

Same mechanism for tokens: extract the palette into one source (e.g.
`tokens.css`) and splice it into all four consumers between markers. One home
for the palette; the build fans it out.

## Acceptance criteria

- `node build.mjs && git diff --stat docs/index.html` shows the spliced block;
  `grep -c "class OpenJamPopup" docs/index.html openjam-popup.js` → 1 and 1,
  with the docs copy generated, not hand-edited.
- Disconfirming input: edit one character inside the spliced block and run the
  build → the edit is overwritten (paste the diff). Proves the splice owns the region.
- Dead code gone: `grep -n "heroWave\|tiltCard\|heroWords\|\.prow" docs/index.html` → no matches.
- Token single source: the palette is authored in one file; `grep` for a
  representative hex shows one authored occurrence, the rest generated between
  markers. Change it once, rebuild → all four consumers update (paste the diff).
- Disconfirming input (tokens): hand-edit a token inside a spliced block and
  rebuild → the edit is overwritten (paste the diff).
- `npm test` green; landing page renders the demo popup (screenshot in PR).
