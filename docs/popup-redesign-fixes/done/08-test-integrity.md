# 08 — Re-strengthen e2e assertions

Depends on: [00-epic](../00-epic.md)

Three places where the redesign left tests asserting the mechanism (or a
private copy of the code) instead of the user-visible outcome. Repo rule: a
criterion with no disconfirming input proves nothing (`CLAUDE.md`, Acceptance
criteria section).

## Problem A — mic picker visibility

`e2e/audio.spec.mjs:110` asserts `!el.hasAttribute("mic")`; on `main` the same
test asserted the outcome (`#micSelect` had `hidden`). A typo in the
`:host([mic]) .mic-body` collapse CSS (`openjam-popup.js:113`) would leave the
picker permanently visible while the suite stays green.

## Problem B — restricted-page failure path

`e2e/extension.spec.mjs:224-236` re-implements `popup.js` `showFailure` inside
`popup.evaluate` (render into a scratch div, extract `.pii-warning`, call
`showError`/`showPii` by hand). It tests its own copy, not the production
branch: `showFailure` (`popup.js:21`) can regress while CI stays green. The
same `.pii-warning` DOM surgery also lives in `popup.js:21` itself — if
issue-link.js ever returns structured parts instead, both copies go away.

## Problem C — screenshot-script gate

`scripts/screenshots.mjs:46` waits on `openjam-popup select`, but the select
always exists in the shadow template and sits inside the collapsed
`.mic-body` (`max-height:0`, `openjam-popup.js:113`) — Playwright's visibility
check can pass before `listMics`/`setMics` completes, so the recording shot can
capture an empty picker.

## Fix

A: assert the picker's effective visibility (bounding box height > 0 when
`[mic]`, 0 when not). B: drive the real path — click `[data-act=toggle]` on the
restricted tab and assert on what `popup.js` itself rendered. C: wait for the
select to be non-empty (`option` count > 0).

## Acceptance criteria

- Disconfirming inputs, one per fix: (A) break the collapse CSS → test fails;
  (B) break `showFailure`'s pii split → test fails; (C) stub `setMics` to never
  run → `node scripts/screenshots.mjs` fails instead of shooting an empty picker.
- `npm test` green with the strengthened assertions; failing-then-passing
  output for each disconfirming input pasted in the PR.
