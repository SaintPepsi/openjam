# Step 11 — Report

Deliver the completion report to Ian. It contains, in this order:

1. **Criterion → evidence table**: one line per acceptance criterion in the
   ticket, each mapped to the pasted command output that satisfies it
   (failing AND passing halves for test criteria). A criterion without output
   is reported as unmet — "Couldn't verify X" is a valid result
   (root `CLAUDE.md`, Acceptance criteria).
2. **Fork and design decisions** (steps 2 and 5): each choice and its
   reasoning, flagged for Ian's review — they are agent-made calls awaiting
   ratification.
3. **Notes from the run**: citation drift, adjacent bugs found, assertions
   that looked wrong — everything recorded via `gate.sh note`, surfaced, not
   left in the state file.
4. **Tree state**: confirmation the working tree is uncommitted
   (`git log -1` matches step 1's; `git status` shows the changes staged for
   Ian's review, not committed).

Do not commit, push, or open a PR — Ian handles commits on this repo unless he
asks in the moment. Never commit local test recordings.

Evidence for the gate: one line, e.g.
`"report delivered: 3/3 criteria evidenced, 1 fork flagged, tree uncommitted at de01c4f"`.
