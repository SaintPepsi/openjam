# OpenJam — dev context

The user owns their data. Everything OpenJam captures stays local and leaves only if the
user shares the file. Every decision answers to that.

## Privacy

- All capture and build is local: CDP (`chrome.debugger`) → in-browser build
  (`report-builder.js`) → one self-contained HTML file. No backend, account, or telemetry.
- New features stay local and self-contained — no network egress, no external runtime deps.

## Tests & CI

- `npm test` = `npm run build` + `bun test test/` (unit) + `playwright test` (e2e). Build
  (`node build.mjs`) bundles rrweb first.
- e2e loads the real unpacked extension headless; fixtures in `test/e2e/`.
- CI runs `npm test` on every PR/push to `main` (`.github/workflows/ci.yml`). Merge-blocking
  checks go through `npm test`; `eval/` (`npm run eval`) is opt-in, outside CI.

## Docs

- Shipped features → `docs/feature-set/` (What it does / What to expect / Test data /
  Related; cross-linked; Test data points at real fixtures).
- Planned/design → `docs/<feature>/` as epic + numbered children (`00-epic.md`, `01-…`).
- Tickets depend forward only — epic + earlier-numbered tickets.

## Acceptance criteria

- Each criterion = a command + output, or `file:line`. Not "verify it works".
- No disconfirming input (one that makes it fail) → it proves nothing; add one.
- "Done / passing" without pasted output = unverified.
- "Couldn't verify X" is a valid result. Prefer a fresh validator over self-grading.
