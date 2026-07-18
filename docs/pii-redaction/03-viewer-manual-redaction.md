# Manual redaction in the report viewer

Part of the **PII redaction** epic (`00-epic.md`). Depends on the spike (`01-spike-tooling.md`).

> **This is the real fix for names — the fast-follow to v1 auto-redaction (`DECISIONS.md` D9/D10).** The epic was triggered by names leaking, and names/free-text can't be caught reliably by regex (`01-spike-recommendation.md` §8). Capture-time auto-redaction (`02`) reduces structured PII but does *not* catch names; this human-in-the-loop scrub does. Sequence it immediately after `02`, not as a late-epic item.

Sometimes PII slips through the capture-time defaults (a name in body text, an ID in a payload). The reviewer should be able to scrub it after the fact, before sharing.

## Behaviour

- A **"Redact"** mode in the viewer. The user highlights/selects content in the replay or in any captured event.
- On selection, OpenJam **finds every occurrence of that value across the entire report** — replay DOM, console args, network payloads, headers, environment data — and replaces them all with a consistent placeholder.
- The user can **persist** redactions so they re-apply automatically next time — the same custom-rule mechanism for saving selectors/patterns for future recordings.

## Ordered mutation queue

Redactions are applied as an **ordered mutation queue**, not independent edits. Each redaction is a find-and-replace over the *current* state of the data, so a later redaction can match text an earlier one created or shifted. They can't be undone in isolation.

- The **queue is the source of truth**; the redacted output is derived by replaying the queue over the original data.
- **Undo** works by rolling back to the point before the chosen redaction and replaying the remaining ones — removing redaction #2 also reverts #3 and #4, which are then re-applied if still valid.
- The queue is shown as a **visible, ordered list** the user can manage.

This area needs experimentation — see open questions.

## Acceptance criteria

Each criterion names the evidence that proves it. Try to break each one before accepting it.

- [ ] Select-and-mask-all → in the viewer select a value, export, `grep -F "<value>" report.html` → 0 matches across replay + all event data (exit 1). Evidence: pasted grep.
- [ ] **Disconfirming check:** grep the same value *before* redaction → it's found (exit 0). Confirms the check can fail.
- [ ] Queue replay correctness → `bun test`: applying redactions `[A,B,C]` then undoing `B` yields byte-identical output to applying `[A,C]` from the original data. Evidence: test asserting equality.
- [ ] **Disconfirming check:** a test where `B`'s target only exists because `A` created it → undoing `A` must also drop/skip `B` without error or leaving `B`'s artifact behind. Evidence: test output.
- [ ] Persist + re-apply → save a queue, load a *fresh* recording, re-apply, assert the persisted values are masked (grep → 0 matches). Evidence: test/grep output.
- [ ] Fail-safe → unit test: a queued redaction that throws is reverted, the user notified, and output equals replaying the queue minus the failed op. Evidence: test output.

Report any case you couldn't make deterministic — mutation-queue edge cases are expected to surface here, and naming them is a valid result.

## Open questions

- **Mutation-queue semantics**: how to handle a redaction whose target no longer exists after an earlier one changed the data; whether the queue replays cleanly and deterministically; how persisted queues re-apply to a *fresh* recording where offsets/content differ. Expect edge cases.
- How manual redaction interacts with the exported, self-contained report — does find-and-replace run against live in-memory data before re-export?

## Scope / notes

- Uses the shared redaction engine from the spike, fed with user selections.
- Screenshot redaction may be deferred if significantly harder than text/DOM redaction.
