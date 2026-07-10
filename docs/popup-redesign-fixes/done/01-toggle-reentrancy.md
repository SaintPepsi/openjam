# 01 — Restore record-toggle re-entrancy guard

Depends on: [00-epic](../00-epic.md), [05](05-component-source-of-truth.md), [05b](05b-render-from-state.md)

## Problem

The old popup disabled the toggle during the async start/stop round-trip
(`git show main:popup.js`, lines 109 and 119: `toggle.disabled = true/false`).
The new `oj-toggle` handler (`popup.js:32-44`) has no in-flight guard, and the
component never disables its button (`openjam-popup.js:272-277`).

Two constructible interleavings on a double-click:

- `background.js:374` sets `session.recording = true` before the debugger attach
  completes, so the second click's `getStatus` reads `true`, sends `stop`, and
  finalizes a seconds-old, near-empty report.
- Both clicks read `recording: false` → two `start` messages; the second hits the
  `background.js:371` guard and returns `Already recording.`, which
  `popup.js:41` paints as a red error over a recording that started fine.

## Fix

Guard in the component: set `disabled` on `_elToggle` when `oj-toggle` fires,
and have the host clear it when the round-trip settles (or expose a
`busy` attribute the host toggles). One guard, both live and demo modes covered.

## Acceptance criteria

- e2e test: open popup, `click()` the toggle twice without awaiting between,
  then assert exactly one recording started (`getStatus` → `recording: true`)
  and no error notice is visible (`openjam-popup .err` hidden). Command:
  `npx playwright test e2e/extension.spec.mjs -g "double-click"` → passing.
- Disconfirming input: revert the guard (re-enable the second click) → the new
  test fails. Paste the failing output in the PR.
- `npm test` green.
