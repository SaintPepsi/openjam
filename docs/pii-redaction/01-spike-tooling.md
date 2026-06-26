# Spike: redaction tooling + shared-engine design

Part of the **PII redaction** epic (`00-epic.md`).

Time-boxed investigation to de-risk the rest of the epic before we build. Output is a short recommendation, not production code.

## Goals

- Decide **what redaction tooling we lean on** rather than hand-rolling regex, weighing:
  - bundle size — MV3 must bundle everything, no remote code, so anything server-side or Python (e.g. Presidio) is out;
  - accuracy and false-positive rate on the kinds of data OpenJam captures;
  - fit for both structured (network/headers) and unstructured (DOM text, console args) content.
  - Browser-bundleable candidates to evaluate: rrweb's built-in masking (`maskAllInputs` / `maskTextSelector`), `redact-pii`, and similar JS/TS libraries.
- Define the **shared redaction engine** interface used by both children: given a value/pattern/selector, mask every occurrence consistently across all captured sources (replay DOM, console, network payloads, headers, environment). The engine must **preserve structure** — redacting inside JSON bodies, headers, or HTML masks values while keeping the payload parseable (no naive string replace that breaks the structure the viewer parses).
- Decide **where redaction sits in the capture pipeline** per source (CDP network events vs rrweb DOM vs screenshots).
- Recommend the **default assumption set** for capture-time redaction (which patterns/headers are on by default).
- Build a **test dataset and harness** that measures redaction effectiveness, so tooling choices are backed by numbers, not vibes.

## Test data + success rate

The spike must produce a labelled dataset and a script that reports how well each candidate redacts it — this is the evidence that drives the tooling decision.

- A **fixture dataset** seeded with known PII across every captured source — DOM text, form inputs, console args, network request/response bodies, headers, environment data. Each PII value is labelled (type + where it appears) so results are checkable.
- Include realistic negatives (non-PII that looks PII-ish) to measure false positives.
- A **scoring harness** that runs a candidate engine over the dataset and reports, per candidate:
  - **recall** — % of seeded PII values masked (misses are the dangerous failure);
  - **false-positive rate** — % of non-PII incorrectly masked;
  - a breakdown by PII type and by source.
- The harness output is the comparison table that justifies the chosen tooling.

## Deliverable

Each item is an artifact someone else can re-run or read — not "we looked into it." Sign off on evidence, and try to break each check.

- [ ] Written recommendation (chosen tooling / engine interface / pipeline placement / default pattern set) committed as a doc → the file exists and a reviewer can cite the `file:line` stating each decision.
- [ ] Labelled PII fixture + scoring harness committed, mirroring the existing `eval/` pattern (`node eval/build-reports.mjs && node eval/run-eval.mjs`) → the harness command runs and prints the recall / false-positive table per candidate. Evidence: pasted table.
- [ ] Harness is **deterministic** → running it twice yields identical numbers. Evidence: two pasted runs that match.
- [ ] **Disconfirming check:** feed the harness a no-op "redactor" that masks nothing → it must report recall ≈ 0%, not 100%. A scorer that always says 100% is worthless. Evidence: pasted run.
- [ ] Harness wired into **CI** so recall can't silently regress → add a step to `.github/workflows/ci.yml` (the existing `npm test` does **not** cover `eval/`, so the harness needs its own step or to be folded into the test script) that runs the scorer and **fails the job if recall drops below an agreed threshold**. Evidence: the workflow `file:line` of the new step + a CI run where deliberately dropping a pattern turns the job red.
- [ ] Recommendation is concrete enough that 02/03 build against it → each open question in 02 and 03 has an answer citable in this doc. Evidence: reviewer maps each open question to a section.

Report anything left unresolved. "Tooling X failed the bundle-size budget, deferred — here's the number" is a valid spike outcome, not a failure.

## Screenshot redaction (OCR)

Screenshots are bitmaps — the captured PII is pixels, not selectable text — so the find-and-replace engine can't touch them directly. The spike should weigh two approaches:

**Option A — re-render from the redacted DOM (preferred to evaluate first).** OpenJam already captures the full rrweb DOM at every moment, so we can take the replay state at the screenshot's timestamp and **re-render it to a fresh image**. Because that DOM has already been text-redacted by the shared engine, the regenerated screenshot is clean by construction — no OCR, no bounding boxes, no extra bundle. The risk: a re-render isn't pixel-identical to the original (timing, cross-origin/canvas/video content, font availability), so it may not faithfully show what the user actually saw. The spike should test fidelity on the fixture.

**Option B — OCR the original bitmap.** OCR the screenshot to recover text plus per-word **bounding boxes**, run that text through the same redaction engine, and **black out / blur each matched box**. Preserves the real pixels, but adds a browser-bundleable OCR dependency (e.g. Tesseract.js / `tesseract-wasm`) — bundle size and the wasm payload are the real concerns. Report OCR accuracy on the fixture screenshots as part of the success-rate numbers.

If neither is viable for v1, the fallback is to either **omit screenshots when redaction is on**, or **replace each with a placeholder** (a "screenshot redacted" tile or a fully blurred version) — never ship a leaky image.

## When redaction runs

Decide the timing model so `02-capture-time.md` can implement it without re-litigating. The hard constraint: redaction must never put the **live recording** at risk. Candidates to validate:

- **Post-recording pass (leading candidate).** Run pattern-based redaction of network bodies, console args, DOM text, and headers after Stop, before export — so the recording is never mutated mid-flight. Raw data would sit in local storage until then, which is acceptable (only the exported file must be clean). Validate: does a post-Stop pass over a full recording perform acceptably, and can it reliably reach every source?
- **Capture-time, passive only.** rrweb's built-in `maskAllInputs` / `maskTextSelector` mask as rrweb records — passive config, not active mutation, so likely no mid-recording risk. Validate: confirm exact option names against pinned `rrweb@2.0.1`, and whether they're robust enough to rely on.

Resolve and record the decision:

- Post-recording vs capture-time vs hybrid — which keeps the recording safe without losing coverage?
- Keep rrweb passive masking on by default, or redact everything in one post-recording pass for a single consistent code path?
- Where does raw-vs-redacted data live between Stop and export, and what's the perf cost of the pass on a large recording?

## Open questions to resolve

- Does manual redaction's find-and-replace run against live in-memory data before re-export, and can persisted redactions re-apply to a *fresh* recording where content differs?
- Screenshot redaction: is OCR-based blackout viable within MV3 bundle limits for v1, or do we defer it (omit screenshots when redaction is on) until a later iteration?
