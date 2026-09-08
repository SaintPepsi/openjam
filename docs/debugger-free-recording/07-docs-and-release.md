# 07 — Docs, viewer badge, release

Depends on: [00-epic](00-epic.md), [06](06-fallback-wiring.md)

## Changes

- `docs/feature-set/data-capture.md`: new section "When Chrome's debugger is unavailable"
  with the epic's loss table, and *Test data* pointing at `test/e2e/foreign-extension/`
  and `e2e/foreign-extension-frame.spec.mjs`.
- `docs/feature-set/bug-report.md`: the report meta gains `capture`; the viewer shows a
  small "debugger-free capture" badge next to Duration when `meta.capture === "inject"`
  (`renderer.js:518` area, `metaItem`). Same badge in the exported HTML (renderer is
  serialised into the export, so one change covers both).
- `manifest.js` DOC string: one sentence on `meta.capture` so AI readers know a missing
  image request is a lane limit, not a page bug.
- `README.md` known-limitations bullet.
- Version → 0.7.0 (`manifest.json`, `package.json`), `docs/RELEASING.md` steps.
- Issue #48: comment with the cause (frame-tree check), the fixture repro, and what 0.7.0
  does; ask the reporter to confirm with their password manager enabled.

## Acceptance criteria

- `npx playwright test e2e/foreign-extension-frame.spec.mjs` asserts the badge text is
  visible in the viewer for the inject-mode report and absent for a cdp-mode one
  (disconfirming half already in the spec).
- `grep -n "capture" docs/feature-set/data-capture.md docs/feature-set/bug-report.md` →
  both hit.
- `npm test` green at 0.7.0; pasted counts.
