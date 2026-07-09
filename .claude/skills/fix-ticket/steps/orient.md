# Step 1 — Orient

Read, in order: the ticket file, the epic's `00-epic.md`, and any execution
guide in the epic directory (e.g. `docs/popup-redesign-fixes/09-execution-guide.md`
— its trap list applies to every ticket in that epic).

Then re-verify every `file:line` citation the ticket makes: `grep -n` for the
quoted code and confirm it is where the ticket says. Citations were accurate
when the ticket was written; earlier tickets landing will have shifted them.
Record any drift as a note (`steps/gate.sh note <RUN_ID> "citation drift:
popup.js:32 → popup.js:47"`) — never edit code at a line number you have not
reproduced this session.

Traps to load before proceeding (from the popup-redesign-fixes guide; check the
epic's own guide for its equivalents):

- If the ticket touches `openjam-popup.js`, check whether
  `docs/index.html` still holds a pasted copy of the component — until ticket
  05 of popup-redesign-fixes lands, an edit to one copy does not reach the other.
- `npm test` runs `node build.mjs` first; judge `docs/index.html` only after a
  fresh build.
- If the fix changes what a component displays, flag it as a `ui = fn(state)`
  ticket (`steps/gate.sh note <RUN_ID> "ui-state: display derives from state"`)
  so Approaches and Implement keep the change flowing through state, not a fresh
  imperative DOM poke.

Evidence for the gate: one line naming what was verified, e.g.
`"6/6 citations reproduced, 1 drift noted"`.
