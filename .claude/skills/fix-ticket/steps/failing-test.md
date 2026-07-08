# Step 6 — Failing test

Write the ticket's disconfirming test before touching production code, run it,
and capture the failing output. This is the evidence half most runs skip; the
gate makes it non-optional (root `CLAUDE.md`, Acceptance criteria: no
disconfirming input → it proves nothing).

Requirements:

- The test must fail **on the intended assertion**, not on a selector typo or
  setup error. Read the failure message and confirm it names the behavior the
  ticket is fixing before recording the gate.
- Assert user-visible outcomes, not mechanism inputs; never re-implement
  production logic inside `evaluate()` — drive the real control
  (`e2e/CLAUDE.md`).
- Shadow-DOM specifics: Playwright locators pierce open shadow roots
  (https://playwright.dev/docs/locators#locate-in-shadow-dom), but
  `querySelector` inside `evaluate()` does not — hop via `el.shadowRoot`.
  Elements inside collapsed containers (`max-height:0`, e.g.
  `openjam-popup.js:113`) still pass `.waitFor()`; assert bounding-box height
  or option counts instead of presence.
- Unit tests: `bun test test/`; e2e: `npx playwright test e2e/... -g "<name>"`
  against the real unpacked extension via `test/e2e/harness.mjs`
  (root `CLAUDE.md`, Tests & CI).

Evidence for the gate: the exact command plus the failing assertion line, e.g.
`"npx playwright test e2e/extension.spec.mjs -g double-click → expect(recording).toBe... Received: false"`.
