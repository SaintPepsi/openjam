# Step 4 — Approaches

Propose 2–3 genuinely distinct fixes for the ticket. Rules inherited from the
Brainstorming engineering skill
(`~/.claude/skills/Brainstorming/engineering/SKILL.md`), bounded for this
pipeline:

- **Equal analytical depth per option.** Under-describing the approach you
  dislike stacks the deck; each gets the same dimensions: structure, principle
  implications, tradeoffs.
- **Evaluate against the principles named in step 3.** A violation is either
  justified explicitly or the approach is revised — never silent.
- **YAGNI ruthlessly.** These tickets are small; an approach that adds
  machinery the acceptance criteria don't demand loses by default.
- **No "too simple to design".** Even a 5-line fix gets its alternatives named
  — one-liners per approach is fine; skipping the comparison is not.
- **`ui = fn(state)` for component-UI fixes.** If the fix changes what a
  component displays, at least one approach must derive that display from state
  and re-render rather than set the DOM imperatively in the handler. An
  imperative-poke approach is fine to propose, but only if it names the state↔UI
  drift it accepts. Record the choice in the step 5 design note.

Bounded deviations from the source skill — these are deliberate, not drift:

- No mode question, no clarifying-question dialogue: the ticket, epic, and
  step 2 fork note are the answers.
- No design doc in `docs/plans/`, no commit, no `writing-plans` handoff — the
  ticket is the plan; the design is recorded in the state file at step 5 and
  ratified by Ian in PR review.

Evidence for the gate: one `steps/gate.sh note <RUN_ID> "approach: ..."` line
per option, then advance with a one-line summary, e.g.
`"3 approaches noted: component guard / host flag / debounce"`.
