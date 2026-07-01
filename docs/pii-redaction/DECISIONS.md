# PII redaction — decision record

Part of the **PII redaction** epic (`00-epic.md`). The canonical "what we decided and
**why**" for the redaction work. Each decision cites its reason and the evidence
behind it (real-recording analysis, the library trial, or the council debate). The
spike (`01-spike-recommendation.md`) and children (`02`/`03`/`04`) implement these.

Status legend: **settled** (decided, build to it) · **validate** (decided in principle,
needs a spike check) · **open** (named, not yet resolved).

---

## How these were reached

- **Real-recording analysis.** A 4.3 MB capture (105 events, 911 rrweb events, ~16.9k
  DOM strings) was scanned and run through candidate engines. Bench scripts:
  `scripts/redact-report.mjs` (three "ways") plus the scan/trial harnesses. The
  recording itself is **never committed** (real personal data).
- **Library trial on that real data.** `redact-pii-core` and `compromise` were run
  against it, not just synthetic strings.
- **Council debate.** Five roles who'd live with the tool daily (Principal Engineer,
  QA Lead, QA Junior, Product Owner, Senior Dev) debated the approach in three rounds.

---

## Decisions

### D1 — Hand-rolled regex + checksums. No third-party PII lib, no ML, no OCR. — **settled**
**Why:** off-the-shelf libraries corrupt the artifact on real data, and a corrupt
report is worse than a leak because people switch redaction off entirely.
**Evidence:** on the real recording, `redact-pii-core` redacted 844/2480 network
strings and 1988/16899 DOM strings, masked 179 non-PII ip-shaped values, **mangled 21
of 25 UUIDs mid-string**, and **broke a JSON body**. Hand-rolled tuned regex: 0
false-positive traps, all 21 JSON bodies still parsed, caught the real PII. ML (NER)
is ~100+ MB — hostile to an MV3 bundle and to "everything ships locally"
(`00-epic.md:42`).

### D2 — Default level TUNED, ON by default. AGGRESSIVE is never the default. — **settled**
**Why:** on real data, recall is easy (22 emails, 1 JWT) but the danger is
over-redaction destroying debugging value. ON-by-default makes it safe out of the box
(the original complaint); AGGRESSIVE over-redacts and must be a deliberate opt-in.
**Evidence:** AGGRESSIVE masked 180 ip-shaped strings + 63 UUIDs + 21 Luhn-passing
order IDs — none personal. Council: a tool that cries wolf gets disabled.

### D3 — Default patterns: email, JWT, bearer, SSN, credit-card (Luhn-validated). Drop `ipv4` and `uuid`. — **settled**
**Why:** `ipv4` matches version strings and dimensions; `uuid` matches correlation
/request IDs the Senior Dev uses to trace a request across console/network/replay.
Both are high false-positive and not personal data.
**Evidence:** real-recording false-positive counts above; Senior Dev: "those UUIDs are
my correlation spine."

### D4 — Trust boundary is **export**, not capture. Capture raw locally; redact at export. — **settled**
**Why:** the people who use OpenJam daily need full-fidelity local data to reproduce
bugs, and the dev who consumes the report needs it intact. Only the *shared file* must
be clean (`00-epic.md:26`). Gating at export also defends the real failure mode: a
tester who turns redaction off for repro and forgets.
**Evidence:** council convergence (QA Junior would work around a capture-time lock; PO:
"if we mask at capture, gate-at-export is theatre"). Raw-at-rest-locally is accepted as
residual risk (see D12).

### D5 — One post-Stop redaction pass over **all** sources, including the rrweb DOM stream. Drop record-time `maskAllInputs`. — **settled**
**Why:** record-time masking is irreversible and would destroy input values needed to
reproduce bugs — "no point masking data we might need." rrweb events are serialized
DOM (a walkable node tree + text/input mutations), so a post-Stop pass can reach and
redact them like every other source. One code path, one rule set, one timing model.
**Exception:** keep rrweb's built-in `maskInputOptions:{password:true}` — password
values are never useful and always sensitive.
**Evidence:** Principal Engineer confirmed a post-Stop pass over recorded rrweb events
is feasible; this flips the spike's earlier "hybrid record-time masking" recommendation.

### D6 — Typed `[REDACTED:<type>]` markers on every removal; structure always preserved. — **settled**
**Why:** the report consumer must be able to tell a redaction from missing data, and a
structure break (unparseable JSON) makes the report useless. A *silently dropped*
marker is the failure QA will hunt.
**Evidence:** Senior Dev non-negotiables — intact correlation IDs, valid JSON, a
visible typed marker per redaction. Real trial: hand-rolled patterns kept all 21 JSON
bodies parseable.

### D7 — Environment data is retained, except URL/title which get matched-info redaction. — **settled**
**Why:** the browser/OS/screen/locale/timezone fingerprint is diagnostic and losing it
guts reproducibility. Only `device.url`/`device.title` and their copies
`meta.pageUrl`/`meta.pageTitle` carry PII (query strings, titles), and they're redacted
only where they match the active rules.
**Evidence:** `background.js:93-107` (env fields), `:424-436` (report shape);
`meta.page*` are copies of `device.*` (`:429-430`) so both must get the same rule.
Open sub-point: include `device.referrer`? (same risk class — recommend yes).

### D8 — Screenshots omitted or placeholdered when redaction is on. Defer OCR and DOM re-render. — **settled**
**Why:** a bitmap can't be content-redacted cheaply, and we must never ship a leaky
image. OCR (Tesseract ≈ 6.6 MB) is too heavy for v1; re-render isn't pixel-faithful.
**Evidence:** `background.js:480-481` already has a "screenshot dropped" placeholder
path to reuse.

### D9 — Names and free-text are a v1 blind spot. Auto-redaction does NOT fix the original complaint. — **settled**
**Why:** the complaint that started this epic was children's **names** leaking, and
regex cannot catch arbitrary names without huge false positives. We must not message
v1 as "names handled."
**Evidence:** `compromise` (NLP names) on real DOM text returned noise — it tagged
code/markup fragments as people. Council unanimous: TUNED-on is "the floor, not the
cure."

### D10 — Manual in-viewer redaction (`03`) is the real fix for names — a fast-follow. — **settled**
**Why:** a human-in-the-loop scrub is the only reliable way to catch names/free-text.
"Fast-follow" = the very next release after v1 auto-redaction, committed as the
immediate next priority — not parked in the backlog.
**Evidence:** council unanimous that `03` is *the* fix; it must not be sequenced as a
late-epic item.

### D11 — Export-time disclosure: a redaction-state indicator + a names warning at the export action. Not a modal. — **settled**
**Why:** protect the flip-off-and-forget leak, and be honest at the moment of sharing
that names aren't auto-detected. OpenJam has no share dialog today (Stop → build →
file), so this is an **indicator + warning on the export control** (and a
block/hard-confirm if redaction is off), not a new modal.
**Evidence:** council wanted a "share dialog"; grounded in the real export flow it
shrinks to an indicator + warning — the heavier "dialog" framing was trimmed as noise.

### D12 — README honesty caveat. — **settled**
**Why:** don't oversell redaction; keep the privacy promise truthful.
**Proposed line:** keep *"Nothing is ever uploaded — you have full control over your
data,"* add *"Redaction reduces but does not guarantee removal of personal data —
names and free-text aren't auto-detected. You're the last check before sharing."*

### D13 — Measure-first: build the labelled fixture + scoring harness; the recall/FP table backs the engine choice. — **validate**
**Why:** the maintainer's call — evidence over bundle-math. The fixture + harness move *into* the
spike, not deferred.
**Evidence:** D13 is the spike's deliverables 2–5 (`01-spike-tooling.md`). Open: the CI
recall threshold number (set after testing).

### D14 — Verification skill: ad-hoc, blind-agent, run against real recordings; the data repository grows over time. — **settled**
**Why:** a fresh agent handed a recording should know what to hunt and confirm both
**no leak** and **no over-redaction** of diagnostics. Used ad-hoc when we have data
(real recordings stay uncommitted); a labelled corpus accretes over time.

### D15 — Residual risk accepted: raw data sits in local storage between Stop and export. — **open/accepted**
**Why:** capture-raw/redact-at-export (D4/D5) means unredacted names live locally until
export. Accepted per `00-epic.md:26` (only the exported file must be clean), but
flagged honestly — export-time scrubbing does not erase at-rest local exposure.

### D16 — Key-name field pass: redact a value by the field it sits in, not only by what it matches. — **settled**
**Why:** value-pattern matching (D3) can't catch a value that carries no signature —
`{ "firstName": "Alice" }` looks like any string, but the **key** says it's PII. We
already redact headers this way (by name, not value); D16 generalizes that to
structured body keys. This is the field-flagging point from practitioner input: when
you know the field, scrub by where it is, not what it looks like. It dents the names
blind spot (D9) for
**structured** payloads — a JSON `email`/`firstName`/`ssn` key now gets caught even
when the regex can't see it.
**How:** a fourth rule kind alongside pattern/header/literal — a normalized key
allowlist (lowercased, separators stripped, **whole-key** match so `className` /
`fileName` don't false-fire). On a flagged key with a primitive value, the value is
replaced with `[REDACTED:field]`; nested objects recurse normally. Two tiers, mirroring
D2/D3: **tuned** (default) carries high-precision keys that are almost always PII
(`password`, `token`, `secret`, `authorization`, `email`, `phone`, `ssn`, `dob`,
`firstName`/`lastName`, `creditCard`, `cvv`); **aggressive** adds broad/ambiguous keys
(`name`, `username`, `address`, `postcode`) that over-redact. ID-shaped keys
(`userId`, `accountId`) stay **out** — they're the correlation spine (D3).
**Limit (honest):** key-name flagging only reaches **structured** data with a telling
key. The names that triggered the epic were in DOM text / rrweb, where there's no key
to flag. So D16 helps payloads, it does **not** replace manual redaction (D10) as the
real fix for names.
**Evidence:** external practitioner input (medical-imaging + database
de-identification): "maintain a function that flags whether a field has potential to
hold PII, and if flagged, scrub it." One-way de-identification (no reverse map) confirms
D6. The ML route raised in the same discussion (AWS Guardrails) is server-side/heavy and
reinforces D1, not a counter to it. To be measured by the harness
(D13) — `scripts/redact-report.mjs` carries the tuned/broad key sets for trialling.

---

## What this changed vs the original spike

- §4 of `01-spike-recommendation.md` recommended **hybrid record-time `maskAllInputs`**;
  D5 **replaces** it with a post-Stop pass over rrweb events, no record-time masking.
- §3's "post-Stop pass for CDP sources" widened (D4/D5) to **all** sources at the
  **export** trust boundary.
- `03` manual redaction was sequenced mid-epic; D10 makes it the **fast-follow** and
  the real fix for the names complaint.
- New: export-time disclosure (D11) and the README caveat (D12).
- New: key-name field pass (D16) added to the engine alongside value patterns —
  scrubs structured PII keys (`email`, `firstName`, …) the regex can't catch.
