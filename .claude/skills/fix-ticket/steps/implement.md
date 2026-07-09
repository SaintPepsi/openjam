# Step 7 — Implement

Make the fix the ticket specifies, per the fork choice recorded in step 2 and
the design recorded in step 5.
Hard boundaries:

- **Diff scope = ticket scope.** Only files the ticket names, plus the test
  file from step 3. An adjacent bug is a note
  (`steps/gate.sh note <RUN_ID> "found: ..."`) for the report, not a fix in
  this diff.
- **Never edit an existing assertion, timeout, or skip-marker to make a suite
  pass.** An assertion that looks wrong is itself a finding — note it and stay
  on this step if it blocks you
  (`docs/popup-redesign-fixes/09-execution-guide.md`, Session protocol).
- **No commits, no pushes, no `manifest.json` version changes** — the extension
  is live on the Chrome Web Store with `v*` tags auto-releasing
  (`docs/popup-redesign-fixes/09-execution-guide.md`, Known traps).
- **`ui = fn(state)` when the fix changes display.** Mutate component state and
  let render reflect it; don't imperatively set the label / timer / meter /
  error notice / a CSS-keyed attribute in a handler such that UI can drift from
  state. Match the state-derived approach recorded at step 5.
- Match the surrounding code's style and comment density; comments state
  constraints the code can't show, nothing else.
- If the fix touches `openjam-popup.js` while `docs/index.html` still carries
  the pasted component copy (pre-ticket-05 of popup-redesign-fixes), apply the
  fix to the source and re-sync the copy in the same diff, and say so in the
  report.

Evidence for the gate: the `git diff --stat` output, e.g.
`"git diff --stat: popup.js +6/-1, e2e/extension.spec.mjs +18/-0"`.
