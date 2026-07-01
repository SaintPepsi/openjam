# Spike findings: PII redaction tooling + shared-engine design

Output of the spike (`01-spike-tooling.md`, the issue source of truth). Decisions
are stated with `file:line` citations into the current capture code and sourced
library facts. Children `02-capture-time.md` / `03-viewer-manual-redaction.md`
build against this.

This doc consolidates the original recommendation, its adversarial review, and the
resolution of that review into one actionable artifact. The audit trail (what was
challenged and how it resolved) is in [§9 Review outcomes](#9-review-outcomes).

> Status: **recommendation, not yet implemented.** The fixture + scoring harness,
> verification skill, and CI wiring (deliverables 2–5 + the skill of
> `01-spike-tooling.md`) are scoped in §10 but not built here — that work writes
> code and runs `node`, so it belongs in an implementation slice. Settled here:
> tooling choice, engine interface, pipeline placement, default pattern set,
> timing model, env handling, and the screenshot decision.

---

## 1. Tooling decision

**Hand-roll a small regex + checksum + header-allowlist engine. Bundle no ML, no
OCR for v1.** The named third-party libraries either don't fit MV3 or don't earn
their bundle weight against what OpenJam captures.

| Candidate | Verdict | Reason |
|---|---|---|
| Microsoft Presidio | ❌ ruled out | Python/spaCy, server-only. No JS port, no WASM build. The epic already excludes it (`00-epic.md:42`). |
| `redact-pii` (original, 3.4.0) | ❌ avoid | ~2.5 MB (gzip ~447 KB, approx/unverified); drags in `@google-cloud/dlp` (network, server-only); unmaintained since 2022-07-29. |
| `redact-pii-core` 4.0.2 / `openredaction` 1.1.2 | ⚠️ optional | Pure-regex, MIT, browser-safe, tens of KB. Fine as a *pattern source*, but they're string-replace engines — they do **not** preserve JSON/header structure, a hard epic requirement (`00-epic.md:25`). We'd wrap them anyway, so we may as well own the patterns. |
| `compromise` 14.15.1 (name detection) | ⚠️ defer | ~131 KB gzip (approx), browser-native, no model. The *only* cheap in-browser name detector. Free-form name detection is high false-positive and not needed for v1's structured-data defaults. Revisit if name recall becomes a requirement. |
| `@xenova`/`@huggingface/transformers` + bert-base-NER | ❌ ruled out | ~100+ MB model + WASM payload (order-of-magnitude). Hostile to an extension bundle and to "ships everything locally." |
| `redactyl.js` / `@zapier/secret-scrubber` | ⚠️ reference only | Useful JSON-key scrubbing patterns, but secret-scrubber had compromised releases in the Nov 2025 npm "Shai-Hulud" attack — pin/audit if ever adopted. We don't need the dependency. |

**Conclusion:** the privacy constraint and the bundle-size constraint point the
same way. Regex + checksums (kilobytes, zero deps, auditable) beat ML (100+ MB) on
both axes. The blind spot is free-form names/addresses — accepted for v1,
documented as a known limitation, revisit with `compromise` later.

**Sourced facts (versions/dates verified via `registry.npmjs.org`, June 2026; byte
sizes approximate and unverified — bundlephobia/npmjs blocked):** `redact-pii`
3.4.0 (2022-07-29, depends on `@google-cloud/dlp`); `openredaction` 1.1.2
(2026-03-19, zero deps); `redact-pii-core` 4.0.2 (2025-05-04, MIT); `compromise`
14.15.1 (2026-05-27, MIT, rule-based); `tesseract.js` 7.0.0 (2025-12-15).

---

## 2. Shared redaction engine — interface

The engine is **type-aware**, not a blind string replace, because the capture is a
typed event array plus sibling metadata, not flat text. Captured values live in
`report.events[].detail` (`event-kinds.js:17-24` documents the per-kind `detail`
shape), `report.rrwebEvents`, and the sibling fields `report.device` /
`report.meta` (`background.js:424-436`).

```js
// redaction-engine.js  (new, bundled into background + viewer + report)
//
//   { type: "pattern", id: "email",  re: /.../g, validate?: (m)=>bool }
//   { type: "header",  names: ["authorization","cookie", ...] }   // case-insensitive
//   { type: "key",     names: ["password","email","firstName", ...] } // by field name, value-blind (DECISIONS.md D16)
//   { type: "literal", value: "alice@acme.com" }                  // manual redaction
//
// MASK = "[REDACTED:<type>]" — stable, greppable.

export function redactString(str, rules) -> string          // text/console/DOM text
export function redactHeaders(obj, rules) -> obj             // header allowlist, structure kept
export function redactJsonBody(raw, rules) -> string         // parse → walk → re-serialize; falls back to redactString on parse error
export function redactEvent(event, rules) -> event           // dispatches by event.kind
export function redactReport(report, rules) -> report        // events[] + named device/meta fields; rrweb handled separately (§4)
```

Design rules (from `00-epic.md` cross-cutting requirements):

- **Structure-preserving.** `redactJsonBody` parses the body, walks values, redacts
  leaf strings, re-serializes — the viewer's `JSON.parse` of network bodies still
  succeeds (the `02` acceptance test at `02-capture-time.md:44`). Headers redact by
  **name allowlist**, never by scanning values, so the object stays an object.
  **Caveat (non-JSON bodies):** request bodies are raw `postData`
  (`background.js:171`), often `x-www-form-urlencoded` / `multipart`; responses
  match `json|text|...|x-www-form-urlencoded` (`background.js:135`). For those,
  `redactJsonBody` falls back to `redactString`. That is safe here because the
  engine replaces *matched literals/patterns*, which doesn't corrupt boundaries —
  structure-aware form/XML parsing is a documented **non-goal for v1**.
- **Safe / reversible (fail closed, don't break the recording).** `redactReport`
  redacts a **copy**; per-event, a throwing rule reverts that event to its original
  and records a notice rather than emitting a half-masked event (`00-epic.md:24`).
- **Consistent across sources.** A literal value redacted in DOM text must also be
  redacted in a network body, a header value, **and the page URL/title** — one rule
  set, applied to every source.
- **Key-name field pass (`DECISIONS.md` D16).** Inside JSON bodies, a value is also
  redacted by the **name of the key** it sits under — `email`, `firstName`, `ssn`,
  `password` — not only by matching a value pattern. This catches structured PII the
  regex can't see (a name has no signature). Matching is **whole-key** on a normalized
  key (lowercased, separators stripped) so `className`/`fileName` don't false-fire; a
  flagged primitive value becomes `[REDACTED:field]`, nested objects recurse. It
  generalizes the header allowlist (which is the same idea, by header name). ID-shaped
  keys (`userId`, `accountId`) are **excluded** — they're the correlation spine (§8).
  Limit: key-name flagging only reaches structured data; free DOM text / rrweb names
  still need manual redaction (§7).

### Per-source dispatch (what `redactReport` walks)

| Source | Fields redacted | Function |
|---|---|---|
| `network` event | `requestHeaders`/`responseHeaders` (allowlist); `requestBody`/`responseBody` (JSON-aware, value patterns **+ key-name pass**, else matched-literal fallback); `url` (query string) | `redactHeaders` + `redactJsonBody` + `redactString` |
| `console` / `error` / `log` event | `detail.message`, `title`, `detail.stack` | `redactString` |
| `screenshot` event | see §5 | omit/placeholder for v1 |
| **`device` / `meta` (env)** | **`device.url`, `device.title`, `meta.pageUrl`, `meta.pageTitle` only** — active rules applied; the rest of `device` (fingerprint) retained | `redactString` (see §6) |
| rrweb events | passive masking at record time + **required** post-pass over serialized input values | §4 |

Grounding: network detail fields are written at `background.js:165-180` (request)
and `:189-205` (response/body); console at `:217-227`; errors at `:229-247`; env
(`navigator.*`, `location.href`) at `background.js:93-107`; the assembled report
shape (events + `device` + `meta`) at `background.js:424-436`; screenshots at
`:121-126`.

---

## 3. Where redaction sits in the pipeline

**The trust boundary is export, not capture (`DECISIONS.md` D4). Capture stays raw
locally; one redaction pass runs at export, over *every* source — network, console,
errors, the env fields in §6, and the recorded rrweb DOM stream (§4).** Placement: a
`redactReport(report, rules)` call before `buildReportHTML` serializes everything via
`JSON.stringify(report)` (`report-builder.js:16`).

Why a single pass at export, not masking at capture:

- The hard constraint is "redaction must never put the **live recording** at risk"
  (`01-spike-tooling.md:56`). A post-Stop pass over the finished `report` object
  mutates a copy in storage, never the in-flight event stream.
- Raw data sitting in local storage between Stop and export is **explicitly
  acceptable** — only the exported file must be clean (`00-epic.md:26`).
- It's a single code path that reaches every CDP source uniformly, instead of
  threading redaction through five CDP event handlers in `background.js`.

The same `redactReport` runs in the viewer for manual redaction (§7), so
capture-time and manual redaction are the *same engine* with different rule inputs
(`00-epic.md:9-11`).

Because raw data stays local until export (`00-epic.md:26`, `DECISIONS.md` D15), the
redaction state surfaces at the **export action**: an indicator of whether redaction
ran, plus a warning that names/free-text aren't auto-detected (§7, `DECISIONS.md`
D9/D11). Not a modal — an indicator + warning on the export control, blocking or
hard-confirming if redaction is off.

---

## 4. rrweb DOM redaction — timing model

**Current state (finding):** rrweb is started with `record({ emit })` and **no
masking options at all** (`src/rrweb-recorder.js:36-46`). Only rrweb's built-in
default applies — `maskInputOptions: { password: true }`.

**Decision: redact rrweb in the same post-Stop pass — no record-time masking
(`DECISIONS.md` D5).** Capture the DOM stream **raw**; at export, walk the recorded
rrweb events (the full-snapshot node tree + text/attribute/input mutations) and apply
the same rule set to text nodes and input values. Record-time `maskAllInputs` is
**dropped**: masking at capture is irreversible and would destroy input values needed
to reproduce bugs, and it breaks the export trust boundary (§3) — you can't un-mask
for local repro. The one kept exception is rrweb's built-in
`maskInputOptions:{password:true}`: password values are never useful and always
sensitive.

Why this works:

- rrweb events are serialized DOM — a walkable node tree in the full snapshot,
  text/attribute/input mutations in increments — so a post-Stop pass reaches and
  redacts them like every CDP source. rrweb records **DOM only** (no network/console;
  console is CDP `Runtime.consoleAPICalled`, `background.js:217`), so the one pass
  covers everything.
- One code path, one rule set, one timing model across all sources (§3).
- Raw input values stay available **locally** for repro; only the exported file is
  scrubbed (`00-epic.md:26`).

**Validate (spike task):** confirm a post-Stop pass over recorded rrweb events
reliably reaches text **and** input values — including `hidden` inputs, which
record-time masking never covered anyway (rrweb #1609) — masks consistently, and
leaves the replay renderable. This is the gate that retires record-time masking
entirely.

---

## 5. Screenshots — decision

**v1: omit screenshots (or replace with a "screenshot redacted" placeholder tile)
when redaction is on.** Defer both re-render and OCR.

- **Option A (re-render from redacted DOM):** attractive because the rrweb DOM is
  already masked, but a re-render is not pixel-faithful (timing, cross-origin /
  canvas / video, fonts) — it may not show what the user saw. Worth a fidelity test
  *later*, not v1.
- **Option B (OCR + black-box):** Tesseract.js bundle ≈ 6.6 MB local (approx). Large
  single-purpose payload for a secondary feature. Defer.
- Fallback chosen: **never ship a leaky bitmap** — drop the screenshot pixels and
  leave a placeholder. The pipeline already has a "screenshot dropped" path under
  storage pressure (`background.js:480-481`), so the mechanism exists.

Resolves the open question at `01-spike-tooling.md:70`: OCR **deferred** for v1.

---

## 6. Environment data handling

**Env data (the `device` fingerprint + `meta`) is retained in v1.** It is
diagnostic — browser, OS, viewport, screen, locale, timezone — and losing it would
gut the report's reproducibility. So no blanket env redaction.

The one exception: the **URL and title fields get the active redaction rule set**,
so a value redacted everywhere else can't survive in an env copy.

- Fields that receive `redactString` with the active rules: `device.url`,
  `device.title`, `meta.pageUrl`, `meta.pageTitle`.
- `meta.pageUrl`/`pageTitle` are copies of `device.url`/`title`
  (`background.js:429-430`). Redacting only the header copy leaves the value in
  `device`, where the merge-blocking grep (`00-epic.md:35`) would still find it — so
  **both copies get the same rule**.
- These are not a new *source* with their own detection; they reuse the engine and
  rules as every other string ("consistent across sources").

> **Open: `device.referrer`** — same query-string-PII risk class as `url`.
> Recommend folding it into the set; left for the implementer/owner to confirm.

---

## 7. Manual redaction (`03`)

Manual in-viewer redaction is **the real fix for the names blind-spot** that triggered
this epic — names/free-text can't be caught by regex (§8, `DECISIONS.md` D9), so a
human-in-the-loop scrub is the answer. It is sequenced as the **fast-follow** to v1
auto-redaction, not a late-epic item (`DECISIONS.md` D10).

- **Find-and-replace runs against live in-memory data before re-export.** The viewer
  holds the parsed `report` in memory; manual redaction feeds `{type:"literal",
  value}` rules into the *same* `redactReport` engine over that object, then re-runs
  `buildReportHTML`. No string-munging of exported HTML.
- **Persist as rules, not offsets.** Persist redactions as literals/patterns, not
  positional offsets, so they re-apply to a *fresh* recording where content differs.

> **Deferred to `03` (M2):** the **ordered mutation-queue** semantics
> (`03-viewer-manual-redaction.md:14-19` — queue as source of truth, a later
> redaction matching what an earlier one produced, undo-by-replay) are **`03`'s
> design decision, not settled here.** Rule-based persistence answers the
> content-drift question; it does not by itself satisfy or replace the ordered-queue
> model. `03` decides whether redactions chain.

---

## 8. Default pattern set (capture-time defaults)

Structured, checksum-validated, high-precision patterns on by default. Names and
addresses are **not** in v1 defaults (the regex blind spot — accepted, documented).

**Content patterns** (regex finds candidates; checksum/Luhn/mod-97 validates):
`email`, `credit_card` (+ Luhn), `us_ssn`, `ipv4`/`ipv6`, `iban` (+ mod-97),
`us_phone`/`intl_phone`, `jwt`, `bearer` token, AWS access key id, Google API key,
Slack token, Stripe live key. High-false-positive patterns (AWS *secret*, generic
api-key) require a **context word** before firing — mirrors Presidio's
pattern+context+checksum design (<https://microsoft.github.io/presidio/evaluation/>).

**Sensitive headers** (redact by name, case-insensitive — OWASP Logging Cheat Sheet
<https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html>):
`Authorization`, `Proxy-Authorization`, `Cookie`, `Set-Cookie`, `X-Api-Key`,
`Api-Key`, `X-Auth-Token`, `X-Access-Token`, `X-CSRF-Token`, `X-XSRF-Token`,
`X-Amz-Security-Token`, `X-Amz-Credential`.

**Sensitive body keys** (redact the value by field name — `DECISIONS.md` D16; matched
whole-key on a normalized key). **Default (tuned):** `password`, `passwd`, `pwd`,
`secret`, `clientSecret`, `token`, `accessToken`, `refreshToken`, `sessionToken`,
`apiKey`, `apiSecret`, `privateKey`, `authorization`, `email`, `emailAddress`,
`phone`, `phoneNumber`, `mobile`, `ssn`, `dob`, `dateOfBirth`, `firstName`,
`lastName`, `fullName`, `givenName`, `familyName`, `surname`, `creditCard`,
`cardNumber`, `cvv`, `cvc`. **Aggressive-only** (broad, over-redacts): `name`,
`username`, `address`, `streetAddress`, `postcode`, `zip`/`zipCode`. **Never**
(correlation spine, D3): `userId`, `accountId`, and other `*Id` keys.

The "Data points to redact" table in `02-capture-time.md:54` stays `_TBD_` until the
recording-analysis first step of `02` runs against a real capture; this default set
is the floor.

---

## 9. Review outcomes

An adversarial review audited this recommendation (all `file:line` citations checked,
checkable library facts verified via npm). Findings and their resolution:

| # | Finding | Resolution |
|---|---|---|
| **M1** (was blocking) | `redactReport` over `events[]` never reached `device`/`meta`, so env data the doc listed as in-scope escaped. | §2 + §6: env is intentionally **retained** except `url`/`title` fields, which now get matched-info filtering; the dispatch table walks them. |
| **M2** (was blocking) | "Rules not offsets" silently dropped `03`'s ordered-mutation-queue requirement. | §7: rule-based persistence answers content-drift only; the ordered-queue model is **`03`'s call**, not settled here. |
| M3 | "JSON-aware" oversold for form/multipart/XML bodies. | §2 caveat: matched-literal fallback is safe; structure-aware form/XML parsing is a **non-goal for v1**. |
| M4 | Off-by-one citation (`02:43` → `:44`). | Fixed in §2. |
| M5 | rrweb won't mask `hidden` inputs; no knob; merge-blocking grep goes red. | §4: post-pass walking rrweb input values promoted from *optional* to **required**. |
| M6 | Library byte-sizes stated precisely but unverified. | §1: versions/dates verified; sizes marked approximate/unverified. |

**Survived scrutiny unchanged:** hand-roll regex over libraries (npm facts hold),
post-Stop pipeline placement, passive rrweb masking, omit/placeholder screenshots,
header redaction by name allowlist.

---

## 10. Outstanding implementation work (fixture + harness + skill + CI)

Deliverables 2–5 + the verification skill of `01-spike-tooling.md` are code that runs
`node` and turns CI red — an implementation slice, not this note. Scoped:

- **Labelled fixture** `eval/pii/fixture.json`: known PII across every source (DOM
  text, inputs, console, request/response bodies, headers, env), each labelled
  `{type, source}`, plus realistic negatives. Seeded from the `02` recording analysis.
- **Scoring harness** mirroring `eval/` (`eval/run-eval.mjs:1-12`): per-candidate
  **recall** (merge-blocking), **false-positive rate**, broken down by type/source.
  Use **F2** (recall-weighted) per the Presidio methodology.
- **Verification skill** (`01-spike-tooling.md` deliverable): a blind-agent check
  that, given a recording/export, hunts the default patterns across every source —
  including the `device`/`meta` URL/title fields (§6) — and flags **over-redaction**
  of diagnostic fields. Complements the numeric harness with a fresh-agent gate.
  Tracked as a todo in `02-capture-time.md`.
- **Determinism:** two runs print identical numbers.
- **Disconfirming check:** a no-op redactor must score recall ≈ 0%, not 100%.
- **CI:** the harness needs its **own** step in `.github/workflows/ci.yml` —
  `npm test` does not cover `eval/` (CLAUDE.md "Tests & CI"). The step fails the job
  if recall drops below threshold; a CI run that deliberately drops a pattern must
  turn the job red.

---

## Sources

External (verified resolving, June 2026):

- rrweb: <https://www.npmjs.com/package/rrweb>; gaps — hidden inputs
  <https://github.com/rrweb-io/rrweb/issues/1609>, snapshot maskInputFn
  <https://github.com/rrweb-io/rrweb/issues/1385>, class-masking
  <https://github.com/rrweb-io/rrweb/issues/874>
- Presidio evaluation (recall/F2): <https://microsoft.github.io/presidio/evaluation/>;
  repo <https://github.com/microsoft/presidio>
- OWASP Logging Cheat Sheet:
  <https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html>
- Credit-card regex: <https://www.regular-expressions.info/creditcard.html>
- Library facts: `redact-pii` <https://www.npmjs.com/package/redact-pii>,
  `redact-pii-core` <https://www.npmjs.com/package/redact-pii-core>,
  `openredaction` <https://www.npmjs.com/package/openredaction>,
  `compromise` <https://www.npmjs.com/package/compromise>,
  `@huggingface/transformers` <https://www.npmjs.com/package/@huggingface/transformers>,
  Tesseract.js <https://github.com/naptha/tesseract.js>

Codebase (cited inline as `file:line`): `background.js`, `event-kinds.js`,
`report-builder.js`, `src/rrweb-recorder.js`.
