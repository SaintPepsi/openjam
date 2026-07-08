# 06 — Fix inert demo stop button

Depends on: [00-epic](00-epic.md), [05](05-component-source-of-truth.md)

## Problem

In demo mode, clicking the primary button never flips recording state:
`_onToggle` (`openjam-popup.js:272-277`) routes to `_demoToggle`
(`openjam-popup.js:356-359`), which never assigns `this.recording`. After
`_startDemoLoop` sets `recording = true` (`openjam-popup.js:333`) the attribute
is never removed, so on the landing page "Stop & open report" is inert: label
never changes, REC timer keeps counting, and the `if (!this.recording)` reset
branch is unreachable. The comment "In demo mode we own the state"
(`docs/index.html:806` in the inlined copy) promises a flip that never happens.
The bug is byte-identical in both copies (`docs/index.html:804-808, 888-891`),
which is why this depends on 05.

## Fix

In `_demoToggle`: when `this.recording`, clear the attribute, stop the demo
loop/timer, and reset `_elapsed`/`_eventCount`; when not recording, restart the
demo. One method, both branches live.

## Acceptance criteria

- Unit or e2e against the built landing page: click the demo popup's button
  while recording → `hasAttribute("recording")` flips to false AND the visible
  label reads "Start recording" (assert the outcome, not just the attribute —
  see [08](08-test-integrity.md)). Command + passing output in the PR.
- Disconfirming input: re-inert `_demoToggle` (early return) → test fails.
- Manual: `npm run build`, open `docs/index.html`, click stop on the hero demo,
  timer stops and label resets (screenshot).
