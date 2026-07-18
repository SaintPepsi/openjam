# Epic: popup-redesign follow-ups

Code review of `feat/popup-redesign-landing` (vs `main`) surfaced regressions the
`<openjam-popup>` rewrite introduced, plus structural drift on the landing page.
This epic tracks the fixes. Findings were verified against the code, not just the diff.

## Problem

The rewrite moved the popup UI into a shadow-DOM web component. In the move:

- Behaviors the old popup enforced were dropped (re-entrancy guard, screenshot
  button, mic-permission recovery, error clearing).
- The component was hand-pasted into `docs/index.html`, so the "one source of
  truth" (`openjam-popup.js:4`) already exists as two copies, and one shared bug
  (inert demo stop) ships in both.
- Dead code from the pre-component landing page survived (`#heroWave`/`#tiltCard`
  wiring, ~100 lines of CSS, a duplicate tilt implementation).
- Two e2e assertions were weakened to mechanism checks.

## Tickets

| # | Ticket | Severity |
|---|--------|----------|
| 01 | [Restore record-toggle re-entrancy guard](done/01-toggle-reentrancy.md) | bug, user-facing |
| 02 | [Restore manual screenshot capture](done/02-screenshot-button.md) | feature regression |
| 03 | [Mic narration state recovery](done/03-mic-state.md) | bug, user-facing |
| 04 | [Wire or gate the mic level meter](done/04-mic-meter.md) | bug + perf |
| 05 | [Single source for the popup component + tokens](done/05-component-source-of-truth.md) | refactor |
| 05b | [Render the component from state](done/05b-render-from-state.md) | refactor |
| 06 | [Fix inert demo stop button](done/06-demo-toggle.md) | bug, landing page |
| 07 | [Style standalone-audio report heading](done/07-audio-section-css.md) | bug, cosmetic |
| 08 | [Re-strengthen e2e assertions](done/08-test-integrity.md) | test debt |
| 09 | [Execution guide for agent-driven implementation](done/09-execution-guide.md) | guide |
| 10 | [Full screenshot tests for the landing page](done/10-docs-page-e2e-screenshots.md) | test coverage |

## Dependencies

05 lands first: it collapses the two component copies and the duplicated design
tokens into single build-spliced sources, so every later component fix edits one
file instead of two. 05b follows, establishing `_render(state)` so display
derives from state. The behavior tickets then depend on both:

- **05 gates 01, 02, 03, 04, 06** — every ticket that edits `openjam-popup.js`.
- **05b additionally gates 01, 03, 04, 06** — every ticket that changes what the
  component displays.

07 (renderer CSS) and 08 (tests) are independent.

An early run of 01 against the un-deduped component applied its guard to *both*
copies — fresh drift, not a fix. That is the ordering this section exists to
prevent; redo any such work against the single source once 05 has landed.

## Principles applied

Every ticket here is a single-source-of-truth failure at one of two altitudes:

- **Truth in two places** — the component (05/06), design tokens (05), CSS in
  the wrong blob (07), tests copying production code (08).
- **UI disagrees with state or docs** — feature unreachable but documented (02),
  switch ON above an empty picker (03), meter shown but never fed (04), label
  frozen while recording flipped (06).

Two principles hold the repair together:

- **Single source of truth, enforced by the build.** 05 makes the component and
  tokens build-generated; a hand-edit to a generated block is overwritten on the
  next build, so the drift cannot silently return.
- **`ui = fn(state)`.** 05b makes the component render from state; the display
  bugs (01/03/04/06) are then fixed by flowing through render, not by adding
  another imperative DOM poke.

No central drift-guard ticket: each ticket owns its own DRY-up and ships a
disconfirming test that fails if its regression returns.

Executing these with an agent (Opus 4.8 or otherwise)? Read
[09-execution-guide.md](done/09-execution-guide.md) first — session protocol,
decision forks that need Ian's call, and codebase-specific traps.

## Out of scope (noted, not ticketed)

- Unhandled `audioEl.play()` rejection in the landing `WaveformPlayer`
  (`docs/index.html:1182`): recoverable by re-click, failure needs offline/404.
- `connectedCallback` not reconnect-safe (`openjam-popup.js:182`): latent;
  nothing reparents the element today, `disconnectedCallback` cleans up timers.
- Easter-egg mp3 double-download (`preload="auto"` + separate `fetch`,
  `docs/index.html:1074`): defer both to first click if it ever matters.
