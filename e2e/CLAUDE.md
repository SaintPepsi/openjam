# e2e tests — conventions

These rules exist because each was violated once and shipped
(see `docs/popup-redesign-fixes/08-test-integrity.md`).

- **Assert the user-visible outcome, not the mechanism input.** The state
  attribute being absent is not the picker being hidden; assert what the user
  sees (bounding-box height, visible text, option count). Mechanism-only
  assertions stay green through broken CSS.
- **Never re-implement production logic inside `evaluate()`.** Drive the real
  path (click the real control, trigger the real failure) and assert on what
  production code rendered. A test executing its own copy of the logic tests
  the copy.
- **Every test names its disconfirming input** — the mutation that makes it
  fail. Run it once and confirm it fails on the intended assertion, not on a
  selector typo. No disconfirming input → the test proves nothing
  (root `CLAUDE.md`, Acceptance criteria).
- **Shadow DOM:** Playwright locators pierce open shadow roots
  (https://playwright.dev/docs/locators#locate-in-shadow-dom);
  `querySelector` inside `evaluate()` does not — hop via `el.shadowRoot`.
  Elements inside collapsed containers (`max-height:0`) can still pass
  `.waitFor()`; don't use presence as a readiness gate.
- Fixtures live in `test/e2e/`; the harness (`test/e2e/harness.mjs`) loads the
  real unpacked extension headless. Never commit local test recordings.
