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

## Fix

Add a screenshot control to `<openjam-popup>` (visible while recording, emits
`oj-screenshot`; host sends the existing `screenshot` action). If removal was
intentional instead: delete the `background.js:577` handler and update
`docs/feature-set/screenshots.md` in the same PR — code, docs, and UI must agree.

## Acceptance criteria

- e2e: while recording, click the new control, stop, and assert the report
  contains a manual screenshot event (fixture flow as in `e2e/extension.spec.mjs`).
  Command: `npx playwright test e2e/extension.spec.mjs -g "manual screenshot"` → passing.
- Disconfirming input: comment out the `oj-screenshot` host wiring → test fails.
- `docs/feature-set/screenshots.md` matches the shipped UI (quote the updated line in the PR).
