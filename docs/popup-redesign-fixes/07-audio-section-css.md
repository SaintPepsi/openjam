# 07 — Style the standalone-audio report heading

Depends on: [00-epic](00-epic.md)

## Problem

The new `#audio-section h2` rules live in REPLAY_CSS (`renderer.js:96-99`), but
report-builder injects REPLAY_CSS only when `hasReplay` (`report-builder.js:47`)
while the `#audio-section` markup is emitted only when
`hasStandaloneAudio = hasAudio && !hasReplay` (`report-builder.js:35`, markup at
`report-builder.js:51`). REPORT_CSS — the always-injected blob
(`report-builder.js:46`) — has no `#audio-section` rule. So the selectors are
dead by construction: the one report shape that renders "Narration"
(storage-quota degradation drops rrweb events but keeps narration,
`background.js:494`) shows it as an unstyled default `h2`.

## Fix

Move the `#audio-section` rules from REPLAY_CSS to REPORT_CSS in `renderer.js`.

## Acceptance criteria

- Unit test building a report with audio and no replay events asserts the
  emitted HTML's always-injected CSS contains `#audio-section` (e.g.
  `bun test test/report-builder.test.js` → passing, output pasted).
- Disconfirming input: build a replay-only report (no audio) — no
  `#audio-section` markup appears; and moving the rule back to REPLAY_CSS makes
  the standalone-audio test fail.
- Visual: open a standalone-audio fixture report; "Narration" renders in the
  design system's section style (screenshot).
