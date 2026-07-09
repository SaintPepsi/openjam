# 02 — Restore manual screenshot capture

Depends on: [00-epic](00-epic.md), [05](05-component-source-of-truth.md)

## Problem

The rewrite deleted the `📸 Capture screenshot` button with no replacement:

- On `main`: `popup.html:32` (`<button id="shot">`) with the handler at
  `popup.js:122` sending the `screenshot` action.
- On this branch: no screenshot control exists in `popup.html`, `popup.js`, or
  `openjam-popup.js` (only button is `data-act="toggle"`, `openjam-popup.js:143`).
- `background.js:577` still implements the `screenshot` action, and
  `docs/feature-set/screenshots.md:12` still documents on-demand screenshots as
  shipped. No commit on the branch mentions removing it (`git log main..HEAD`).

A shipped v0.5.0 feature is unreachable from the UI while its docs advertise it.

## Decision (Ian, 2026-07-09)

No manual screenshot control in the popup. Automatic capture stays as is —
start, stop, and on-error (`background.js:402/411/270`) — which is enough visual
timeline for a bug report. This is neither "restore the button" nor the ticket's
original "delete the handler" removal branch: the `screenshot` action handler is
retained because automation depends on it.

## Fix

1. Ratify that `<openjam-popup>` has no screenshot control (it already doesn't;
   the only button is `data-act="toggle"`).
2. Keep the `background.js:577` `screenshot` action handler. Do **not** delete
   it: the e2e drives it (`e2e/extension.spec.mjs:56`,
   `sendAction(popup, { action: "screenshot" })`) and so does
   `scripts/screenshots.mjs`. It is automation-facing, not user-facing.
3. Reconcile `docs/feature-set/screenshots.md`: drop the "on demand while
   recording" bullet so code, docs, and UI agree. Start/stop + on-error stay.

## Acceptance criteria

- No screenshot control in the component:
  `grep -n "data-act" openjam-popup.js` → only `toggle` and `mic`, no capture control.
- Auto-capture intact: `npx playwright test e2e/extension.spec.mjs -g "captures console, network and screenshots"` → passing (it asserts ≥2 screenshot rows from the start + manual-via-automation captures).
- Handler retained, and its retention is load-bearing. Disconfirming input:
  delete the `background.js:577` `screenshot` case → the e2e above fails on the
  screenshot-row assertion. Paste the failing output, then restore.
- `docs/feature-set/screenshots.md` matches the shipped UI: quote the updated
  bullet list (no "on demand" line) in the PR.
