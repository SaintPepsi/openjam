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
| 01 | [Restore record-toggle re-entrancy guard](01-toggle-reentrancy.md) | bug, user-facing |
| 02 | [Restore manual screenshot capture](02-screenshot-button.md) | feature regression |
| 03 | [Mic narration state recovery](03-mic-state.md) | bug, user-facing |
| 04 | [Wire or gate the mic level meter](04-mic-meter.md) | bug + perf |
| 05 | [Single source for the popup component](05-component-source-of-truth.md) | refactor |
| 06 | [Fix inert demo stop button](06-demo-toggle.md) | bug, landing page |
| 07 | [Style standalone-audio report heading](07-audio-section-css.md) | bug, cosmetic |
| 08 | [Re-strengthen e2e assertions](08-test-integrity.md) | test debt |

Order matters once: 06 should land after 05 so the fix is made in one file, not
re-pasted into two. Everything else is independent.

Executing these with an agent (Opus 4.8 or otherwise)? Read
[09-execution-guide.md](09-execution-guide.md) first — session protocol,
decision forks that need Ian's call, and codebase-specific traps.

## Out of scope (noted, not ticketed)

- Unhandled `audioEl.play()` rejection in the landing `WaveformPlayer`
  (`docs/index.html:1182`): recoverable by re-click, failure needs offline/404.
- `connectedCallback` not reconnect-safe (`openjam-popup.js:182`): latent;
  nothing reparents the element today, `disconnectedCallback` cleans up timers.
- Easter-egg mp3 double-download (`preload="auto"` + separate `fetch`,
  `docs/index.html:1074`): defer both to first click if it ever matters.
- Design tokens quadruplicated (component `:host`, `renderer.js` REPORT_CSS,
  `viewer.html` hexes, landing `:root`): 05's build-splice mechanism is the
  natural home if palette churn starts to hurt.
