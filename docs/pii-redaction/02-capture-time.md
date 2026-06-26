# Capture-time auto-redaction

Part of the **PII redaction** epic (`00-epic.md`). Depends on the spike (`01-spike-tooling.md`).

A global **"Redact PII"** toggle that scrubs personal data from everything OpenJam captures before it reaches the report.

## Behaviour

- **On by default** — safe out of the box; users opt out, not in.
- **Global** — one toggle that applies to all recordings.
- **Remembered between sessions** — persists (e.g. `chrome.storage`) and survives browser restarts.

Per-domain overrides are out of scope here — see the follow-up `04-domain-management.md`.

Default assumptions so it "just works":

- Common PII patterns masked out of network/console/DOM content — emails, phone numbers, credit-card-shaped numbers.
- Sensitive request/response headers masked — `Authorization`, `Cookie`, `Set-Cookie`.

### Input masking is selective, not blanket

Masking *every* input destroys debugging value — reproducing a bug often depends on seeing what was actually typed, and nothing is shared externally unless the user chooses to share the file. So input masking is **sensible by default, not all-or-nothing**:

- **Default:** mask only inputs that are clearly sensitive — `type="password"`, and field values matching the PII patterns above (emails, card-shaped numbers, etc.). Ordinary inputs stay visible so the report is still useful for debugging.
- **User option:** a control over input-masking level — at minimum **off / sensitive-only (default) / mask all** — so users who handle real PII can lock it down, and users on test data can keep everything visible.
- The exact "sensible default" set is part of what the recording analysis (below) and the spike decide; blunt `maskAllInputs` is explicitly *not* the default.

### Make the privacy model clear in the UI

Because the trade-off is "useful vs. masked," the UI should make the privacy model obvious so users can choose sensibly: **nothing is uploaded or shared externally — the entire report lives in a single local file, and only travels if you share that file.** That framing turns "redact everything" from a default into an informed choice.

## When redaction runs

The hard constraint: redaction must never put the **live recording** at risk. *How* that's honoured — post-recording pass, passive capture-time masking, or a hybrid — is **decided by the spike** (`01-spike-tooling.md`, "When redaction runs"). This issue implements whatever the spike concludes; it does not re-open that question.

## Acceptance criteria

Each criterion names the evidence that proves it. Try to break each one before accepting it.

- [ ] Toggle present and defaults ON on a fresh profile → e2e with no stored settings asserts ON before any interaction. Evidence: `playwright test` output.
- [ ] Persists across restart → toggle OFF, reload extension / restart context, assert still OFF. Evidence: `playwright test` output.
- [ ] Default data points masked → record the seeded-PII fixture with redaction ON, export, `grep -F -f seeded-pii.txt report.html` → 0 matches, exit 1. Evidence: pasted command + exit code.
- [ ] **Disconfirming check:** same grep on a recording made with redaction OFF → matches present (exit 0). Proves the grep + fixture actually detect leaks.
- [ ] Structured data stays parseable → a `bun test` that `JSON.parse()`s every redacted network body in the exported report and asserts no throw. Evidence: test output.
- [ ] Default data-point list documented per source → the "Data points to redact" table has no `_TBD_` rows and each row cites where in the analysed recording it was found. **Blocked until the recording analysis (first step) is done.**
- [ ] Selective input masking by default → record a fixture with a `password` field, an email-valued field, and an ordinary text field; export with default settings, then grep the report → password and email values absent (exit 1), ordinary input value present (exit 0). Evidence: pasted greps. (Proves it's *not* blanket masking.)
- [ ] Input-masking level control works → with level set to "mask all", the ordinary input value is now absent (exit 1); with "off", the password value is present (exit 0). Evidence: pasted greps for each level.
- [ ] Privacy model shown in UI → assert the popup/options renders the "nothing is shared externally; report lives in one local file" notice. Evidence: `playwright test` asserting the text node exists, or `file:line` of the rendered string.
- [ ] Fail-safe → unit test injects a redactor that throws on one event; assert the report still exports, the user is notified, and that event is reverted (not half-masked). Evidence: test output.
- [ ] Report indicates redaction applied → grep the exported HTML for the marker element/flag → ≥1 match. Evidence: pasted grep.

Report any criterion you couldn't produce evidence for — especially the TBD-blocked list item.

## Data points to redact (to be filled in)

**First step of this issue (before coding):** capture a representative real recording and analyse it for the sensitive data points it actually contains, then fill the table below. The list is derived from real data, not assumed up front. This analysis stays within the issue/recording — it does not need to be done in a chat context. Output seeds the spike's fixture (`01-spike-tooling.md`) and the default pattern set.

| Source | Sensitive data points | Notes |
|---|---|---|
| DOM text | _TBD_ | |
| Form inputs | _TBD_ | |
| Console args | _TBD_ | |
| Network request/response bodies | _TBD_ | |
| Headers | _TBD_ | |
| Environment data | _TBD_ | |

## Scope / notes

- v1 is defaults-only via the global toggle; user-configurable custom rules are a follow-up.
- Per-domain on/off overrides (and managing that list) are a separate follow-up — `04-domain-management.md`, lowest priority — they need their own UX design.
- Uses the shared redaction engine from the spike, fed with the default pattern set.
