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
- Sensitive **body fields masked by key name** — a value under `password`, `email`,
  `firstName`, `ssn` (etc.) is redacted because of the field it sits in, even when the
  value itself matches no pattern (`DECISIONS.md` D16). Catches structured PII the
  content patterns can't; does not reach free DOM text (still a names blind spot).

### Input masking is selective and happens at export

Input values are **captured raw** and redacted at export by the same content rules as
everything else (`DECISIONS.md` D4/D5) — so reproducing a bug never loses what was
typed locally, and only the shared file is scrubbed. Masking *every* input would
destroy debugging value, so it stays selective:

- **Default:** `type="password"` is masked at record time (never useful); other input
  values are redacted at export only where they **match the active PII patterns**
  (emails, card-shaped numbers, etc.). Ordinary inputs survive in the export.
- **User option:** an input-masking level — **off / sensitive-only (default) / mask
  all** — applied by the export-time pass. "Mask all" is a deliberate opt-in for users
  on real PII; it is never the default (`DECISIONS.md` D2).
- Record-time `maskAllInputs` is explicitly **not** used — it's irreversible and would
  remove values needed for repro (`DECISIONS.md` D5).

### Make the privacy model clear at export

Because the trade-off is "useful vs. masked," the UI makes the model obvious so users
choose sensibly: **nothing is uploaded — the report is a single local file that only
travels if you share it.** And because **names/free-text are a v1 blind spot**
(`DECISIONS.md` D9), the **export action** carries a redaction-state indicator plus a
warning — *names aren't auto-detected; review before sharing* — and blocks or
hard-confirms if redaction is off (`DECISIONS.md` D11). Not a modal: an indicator +
warning on the export control.

## When redaction runs

**Settled (`DECISIONS.md` D4/D5):** the trust boundary is **export**, not capture.
Capture stays raw locally; one redaction pass runs at export over **every** source —
network, console, errors, env URL/title, and the recorded rrweb DOM stream. There is
**no record-time masking** (`maskAllInputs` is dropped — it destroys input values
needed for repro), with the sole exception of rrweb's built-in `password` masking.
This issue implements that; it does not re-open the timing question.

## Acceptance criteria

Each criterion names the evidence that proves it. Try to break each one before accepting it.

- [ ] Toggle present and defaults ON on a fresh profile → e2e with no stored settings asserts ON before any interaction. Evidence: `playwright test` output.
- [ ] Persists across restart → toggle OFF, reload extension / restart context, assert still OFF. Evidence: `playwright test` output.
- [ ] Default data points masked → record the seeded-PII fixture with redaction ON, export, `grep -F -f seeded-pii.txt report.html` → 0 matches, exit 1. Evidence: pasted command + exit code.
- [ ] **Disconfirming check:** same grep on a recording made with redaction OFF → matches present (exit 0). Proves the grep + fixture actually detect leaks.
- [ ] Structured data stays parseable → a `bun test` that `JSON.parse()`s every redacted network body in the exported report and asserts no throw. Evidence: test output.
- [ ] Key-name field pass works (`DECISIONS.md` D16) → record a network body containing `{"firstName":"<signature-free name>","userId":"<uuid>"}`, export with defaults, grep the report: the name value absent (exit 1), the `userId` value present (exit 0). Proves a value with no pattern signature is caught by its key, and the correlation-ID key is *not* over-redacted. **Disconfirming check:** a key like `className` holding the same string is **not** redacted (whole-key match, not substring). Evidence: pasted greps.
- [ ] Default data-point list documented per source → the "Data points to redact" table has no `_TBD_` rows and each row cites where in the analysed recording it was found. **Blocked until the recording analysis (first step) is done.**
- [ ] Selective input masking by default → record a fixture with a `password` field, an email-valued field, and an ordinary text field; export with default settings, then grep the report → password and email values absent (exit 1), ordinary input value present (exit 0). Evidence: pasted greps. (Proves it's *not* blanket masking.)
- [ ] Input-masking level control works → with level "mask all", the ordinary input value is now absent (exit 1); with "off", the email-valued input is present (exit 0) — redaction off means no content pass. (Password stays masked regardless: it's record-time, independent of the toggle, `DECISIONS.md` D5.) Evidence: pasted greps for each level.
- [ ] Capture stays raw; redaction is at export (`DECISIONS.md` D4) → inspect the stored report *before* export: a seeded PII value is present (exit 0). Export, then grep the file: absent (exit 1). Proves redaction runs at export, not capture. Evidence: pasted greps for both.
- [ ] Export disclosure shown → the export control renders the redaction-state indicator + a "names aren't auto-detected; review before sharing" warning, and blocks/hard-confirms when redaction is off (`DECISIONS.md` D11). Evidence: `playwright test` asserting the text node + the off-state confirm, or `file:line` of the rendered strings. **Disconfirming check:** with redaction on, the off-state block does not fire.
- [ ] Fail-safe → unit test injects a redactor that throws on one event; assert the report still exports, the user is notified, and that event is reverted (not half-masked). Evidence: test output.
- [ ] Report indicates redaction applied → grep the exported HTML for the marker element/flag → ≥1 match. Evidence: pasted grep.
- [ ] Blind-agent verification passes → run the spike's redaction-verification skill against the redacted export of the seeded fixture; it reports no PII leak and no over-redacted diagnostic field. **Disconfirming check:** run it against a redaction-OFF export of the same fixture → it must report leaks. Evidence: pasted skill output for both runs.

Report any criterion you couldn't produce evidence for — especially the TBD-blocked list item.

## Data points to redact (to be filled in)

**First step of this issue (before coding):** capture a representative real recording and analyse it for the sensitive data points it actually contains, then fill the table below. The list is derived from real data, not assumed up front. This analysis stays within the issue/recording — it does not need to be done in a chat context. Output seeds the spike's fixture (`01-spike-tooling.md`) and the default pattern set.

**Todo — drive this with the verification skill:** run the spike's **redaction-verification skill** (`01-spike-tooling.md`) over the captured recording. Given a recording it reports what PII is present and which source/field carries it — that's the input that fills the table below. After redaction, re-run it on the exported report as a standing gate: it must report no leak *and* no over-redaction of the diagnostic fields (`userAgent`, `viewport`, `screen`, `timezone`, …). The skill is what lets a fresh agent grade any future recording without re-deriving "what to look for."

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
