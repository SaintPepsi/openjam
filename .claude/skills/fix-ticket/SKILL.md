---
name: fix-ticket
description: Execute one ticket from a docs/<epic>/ directory through a gated, evidence-checked pipeline. USE WHEN executing a ticket, "execute docs/<epic>/<ticket>.md", implementing a numbered epic ticket, or resuming an interrupted ticket run.
---

# fix-ticket — gated ticket execution

Executes exactly one ticket file (`docs/<epic>/<NN>-<slug>.md`) end to end. The
sequence below is enforced by `steps/gate.sh`, not by discipline: each gate
demands one line of lookable evidence, and the dispenser refuses to record step
N while step N−1 has no recorded pass.

Scope rules that apply to every step: the diff contains only what the ticket
names; existing assertions are never edited to make a suite pass; no commits,
pushes, or `manifest.json` version changes — the working tree is left ready for
Ian's review (repo root `CLAUDE.md`; `docs/popup-redesign-fixes/09-execution-guide.md`).

Codebase pattern — **`ui = fn(state)`**: when a fix changes what a component
displays, flow the change through **state → render**, never a fresh imperative
DOM poke in a handler. Scattered pokes drift UI out of sync with state. A lens
at **Approaches** (step 4) and a boundary at **Implement** (step 7).

Steps 3–5 inline the design phases of the Brainstorming engineering skill
(`~/.claude/skills/Brainstorming/engineering/SKILL.md`), deliberately bounded:
no design doc is written or committed, and no `writing-plans` handoff happens —
the ticket is the implementation plan, the design lives in the state file, and
Ian ratifies it in PR review.

## Gated dispenser protocol

Execute the ordered list below **top to bottom**, one step at a time, with `steps/gate.sh`
as the pacemaker. The list stays visible on purpose — later steps' rules may depend on
knowing what comes after — but **passage through it is mechanical**, recorded in the state
file rather than asserted from memory.

- **Start:** `steps/gate.sh init <RUN_ID>` — creates the state file and prints the first step.
  `<RUN_ID>` = epic dir + ticket number, e.g. `popup-redesign-fixes-02`.
- For a step that names a detail file (`→ steps/<file>.md`), read that file **only when
  the dispenser hands you the step** — never read ahead.
- **When a step's gate is met, record it:** `steps/gate.sh advance <RUN_ID> <step> "<one
  line of concrete evidence>"` — then take the next step from the script's output. The
  script refuses to record step N while step N−1 has no recorded pass, so an unmet gate
  stays shut by mechanism, not by discipline.
- **If a gate is not met, report why and stay on the step.**
- Decisions worth remembering (a fork choice, a loop re-entry reason) go in the state
  file too: `steps/gate.sh note <RUN_ID> "<one line>"`.
- Revisiting an earlier step is allowed; record the re-entry by `advance`-ing that step
  again. That is expected, not an error.
- **Resuming after an interruption or compaction:** `steps/gate.sh status <RUN_ID>` — the
  state file, not memory, says where the workflow stands.

## The pipeline

1. **Orient** — read the ticket, its epic's `00-epic.md`, and any execution guide in the epic dir; re-verify every `file:line` citation. `→ steps/orient.md`. **Gate:** every citation grep-reproduced this session, drifted ones corrected via `note`.
2. **Fork** — identify any decision fork in the ticket (mutually exclusive fixes); choose one and record the reasoning for Ian's PR review. **Gate:** a note reading `fork: <choice> — <reason>`, or `fork: none` when the ticket specifies a single fix.
3. **Principles** — read `~/.claude/skills/Brainstorming/engineering/principles.md`. **Gate:** a note naming the 2–3 principles most load-bearing for this ticket and why.
4. **Approaches** — propose 2–3 distinct fixes, each evaluated against those principles at equal depth. `→ steps/approaches.md`. **Gate:** a note per approach: `approach: <name> — <principle implications, tradeoff>`.
5. **Design** — choose one approach and record the design. **Gate:** a note reading `design: <chosen> — beats <runner-up> because <reason>`; flagged for Ian's ratification in the report, per the fork rule.
6. **Failing test** — write the ticket's disconfirming test and run it before touching production code. `→ steps/failing-test.md`. **Gate:** the test command plus its FAILING output, failing on the intended assertion.
7. **Implement** — make the fix per the recorded design, inside ticket scope only. `→ steps/implement.md`. **Gate:** `git diff --stat` output listing only files the ticket names (plus its test file).
8. **Pass** — re-run the ticket's test command. **Gate:** the same command from step 6 plus its PASSING output.
9. **Suite** — run the full check. **Gate:** the tail of `npm test` output showing build, unit, and e2e all green.
10. **Simplify** — invoke the **simplify skill** (via the Skill tool) on the ticket's diff; if it changes code, re-run `npm test`. **Gate:** `simplify: <what it cleaned> — npm test green` or `simplify: no-op — nothing to apply`.
11. **Report** — deliver the completion report and leave the tree uncommitted. `→ steps/report.md`. **Gate:** a criterion→evidence line for every acceptance criterion in the ticket, and `git log -1` unchanged since step 1.
