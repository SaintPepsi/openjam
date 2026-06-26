# Epic: PII redaction

OpenJam captures whatever's on the page — console logs, network requests/responses, DOM snapshots, and screenshots — verbatim. On any page showing real user data, that data (names, emails, identifiers, full payloads) gets baked into the exported HTML report.

The report is self-contained and never uploaded anywhere, which is great for privacy in transit. But the file itself still contains the captured PII, so the moment it's shared — the whole point of the tool — the PII travels with it. That currently limits OpenJam to test environments with no real data.

This epic makes OpenJam safe to use against real data by redacting PII at two points: **automatically at capture time**, and **manually while reviewing the report**.

## The shared engine

Both surfaces run on one redaction engine: given a value (or pattern/selector), mask every occurrence consistently across all captured sources — replay DOM, console args, network payloads, headers, environment data. Capture-time redaction feeds it default patterns; manual redaction feeds it user selections. Designing this engine is the first piece of work.

## Children

- [ ] **Spike — redaction tooling + shared-engine design** (`01-spike-tooling.md`)
- [ ] **Capture-time auto-redaction** (`02-capture-time.md`)
- [ ] **Manual redaction in the report viewer** (`03-viewer-manual-redaction.md`)
- [ ] **Per-domain redaction overrides** (`04-domain-management.md`) — follow-up, lowest priority

## Cross-cutting requirements

These apply to every child, not just one:

- **Safe, reversible mutations (fail closed, but don't break the recording).** Redaction must never kill or corrupt the recording. Each redaction is applied as a safe/transactional operation — if it fails, it's reverted cleanly and the user is **notified**, leaving the recording intact rather than half-redacted or lost.
- **Preserve structured data.** Redacting inside JSON network bodies, headers, or HTML must keep them parseable — mask values without breaking the structure the viewer relies on.
- **Redacted output only — raw may stay local.** It's acceptable for unredacted data to live in local storage during a session; the hard requirement is that PII never reaches the **shared/exported report file**.

## Definition of done (epic)

Every item is signed off on **evidence** — a pasted command + its output, or a `file:line` citation — never on judgement. Before accepting any check, try to make it fail.

- [ ] Redaction on by default for new recordings → e2e on a fresh profile (no stored settings) asserts the toggle reads ON before any interaction. Evidence: `playwright test` output.
- [ ] Setting persists across sessions → toggle OFF, reload the extension / restart the browser context, assert still OFF. Evidence: `playwright test` output.
- [ ] Users can manually scrub leaks before sharing → in the viewer, redact a value, export, then `grep -F -f seeded-pii.txt report.html` → 0 matches, non-zero exit. Evidence: pasted command + exit code.
- [ ] End-to-end: record the seeded-PII fixture, apply both auto and manual redaction, export → `grep -F -f seeded-pii.txt report.html` prints nothing and exits 1. Evidence: pasted command + exit code. (Local storage is **not** grepped — raw there is acceptable.)
- [ ] **Disconfirming check:** run the same grep against a recording made with redaction OFF → it must find the PII (exit 0). A grep that can't catch a known leak proves nothing.

Report any DoD item you could not produce evidence for. An honestly-reported "couldn't verify X" is a correct result, not a miss.

## Notes

- MV3 must bundle everything; no remote code. Any tooling has to be browser-bundleable (rules out server/Python tools like Presidio).
- Screenshot redaction (blur/region masking) is harder than text/DOM redaction and may be deferred across children.
