# 05 — Single source for the popup component

Depends on: [00-epic](00-epic.md)

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

## Fix

`build.mjs` already bundles rrweb (repo `CLAUDE.md`, Tests & CI section). Add a
step that splices `openjam-popup.js` into `docs/index.html` between markers
(e.g. `<!-- openjam-popup:start/end -->`), and delete the pasted copy, the dead
hero wiring, `heroWords`, the tilt IIFE, and the orphaned CSS blocks.

## Acceptance criteria

- `node build.mjs && git diff --stat docs/index.html` shows the spliced block;
  `grep -c "class OpenJamPopup" docs/index.html openjam-popup.js` → 1 and 1,
  with the docs copy generated, not hand-edited.
- Disconfirming input: edit one character inside the spliced block and run the
  build → the edit is overwritten (paste the diff). Proves the splice owns the region.
- Dead code gone: `grep -n "heroWave\|tiltCard\|heroWords\|\.prow" docs/index.html` → no matches.
- `npm test` green; landing page renders the demo popup (screenshot in PR).
