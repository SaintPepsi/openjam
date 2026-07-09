# 03 — Mic narration state recovery

Depends on: [00-epic](00-epic.md), [05](05-component-source-of-truth.md), [05b](05b-render-from-state.md)

Two related regressions in the mic toggle path; fix together.

## Problem A — revoked permission is silent

`popup.js:89-90` sets `oj.micEnabled = true` from stored settings *before* the
grant check, then skips `listMics` when `micGranted()` is false. Result: the
switch renders ON above an expanded, empty picker (`:host([mic]) .mic-body`
expands it, `openjam-popup.js:113`) with no warning and no grant flow. On
`main`, `loadAudioSettings` always called `populateMics` (`main:popup.js:16-20`),
which opened `mic-permission.html` on a missing grant (`main:popup.js:37-39`).
At record time the failure stays silent too: `background.js:313-318` catches the
getUserMedia failure and proceeds without audio, leaving only a warning event
inside the report timeline.

## Problem B — stale error notice

The `oj-mic-toggle` handler never clears the error notice: uncheck returns early
(`popup.js:74`) and a successful `listMics` (`popup.js:80`) doesn't touch it;
`clearNotices` runs only in the record-toggle path (`popup.js:33`). On `main`
the error was hidden on both uncheck (`main:popup.js:73`) and success
(`main:popup.js:55`). So "Opening a tab to grant microphone access…" persists
after the condition it describes is gone.

## Fix

In `loadAudio`: when `s.enabled` but the grant is missing, either reflect the
switch OFF with a hint, or keep it ON and reopen the grant flow (main's
behavior). In the mic-toggle handler: clear the mic error on uncheck and on
successful `listMics`.

## Acceptance criteria

- e2e (fresh context, no grant, `audioSettings.enabled=true` pre-seeded): popup
  opens with either the switch OFF or a visible grant prompt — assert one,
  not "verify it works". Command: `npx playwright test e2e/audio.spec.mjs -g "revoked"` → passing.
- e2e: trigger the mic error, toggle mic off, assert the error notice is hidden.
- Disconfirming input: remove the new clear call → the stale-error test fails.
- `docs/feature-set/audio-narration.md:11-12` updated — it still documents the
  removed `#micSelect` id and the old "🎙 Record audio" checkbox.
