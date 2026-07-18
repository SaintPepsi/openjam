# Popup-redesign-fixes — anti-drift restructure — Design

**Date:** 2026-07-09

## Problem

The `popup-redesign-fixes` epic exists because a copy-paste component rewrite
introduced drift: two copies of `<openjam-popup>`, a byte-identical bug shipped
in both (06), CSS stranded in the wrong blob (07), tests asserting private
copies of production code (08), and design tokens quadruplicated (noted
out-of-scope). The epic already *repairs* drift ticket by ticket, but nothing
names the through-line or prevents the **next** drift, and the dependency graph
lets drift-creating work happen mid-epic.

Two live proofs the current structure is insufficient:

- **An agent ran ticket 01 and applied the re-entrancy guard to *both* copies**
  of the component (05 had not landed). That is fresh drift, not a fix: after 05
  dedupes, one copy vanishes and the guard's survival is left to chance. The 01
  work as done is throwaway and must be redone against the single source.
- 06 is byte-identical in both copies today for the same reason.

## Constraints

- OpenJam is privacy-local: no network egress, no new runtime deps, everything
  self-contained (root + `docs/CLAUDE.md`).
- The extension is live on the Chrome Web Store; manifest bumps / release tags
  are out of scope for the epic (09).
- Acceptance criteria must be command + output with a disconfirming input (root
  `CLAUDE.md`).
- `docs/index.html` is the committed GitHub Pages source; its `<openjam-popup>`
  block is build-generated after 05.

## Approaches Considered

**Guard mechanism**

1. **A — Build-idempotency test.** A test runs `node build.mjs` and asserts the
   working tree for generated files is clean; a hand-edit to a spliced block or
   a skipped rebuild turns CI red. Enforces the real invariant (generated ==
   source). Cheap, no new abstractions.
2. **B — Grep-count guards.** Assert fixed duplication counts. Simpler, but
   magic numbers rot and it *blesses* "2 copies is fine" — the drift we dislike.
3. **C — Full single-source extraction (component + tokens), then A.** Extend
   the splice mechanism to a single token source injected into component /
   renderer / viewer / landing, so idempotency covers everything. Biggest
   change; kills the last DRY violation properly. **Chosen.**

**Where the guard lives**

- A central "drift-police" ticket 10 vs **each ticket owning its own DRY-up and
  disconfirming guard.** Chosen: distributed. No central ticket. Responsibility
  travels with the change that could reintroduce the drift.

**How `ui = fn(state)` enters**

- Fold into each behavior ticket vs a **foundational `05b` establishing
  `_render(state)`, reused by 01/03/06.** Chosen: 05b. A shared render exists
  once; behavior tickets stay tiny and cannot each reinvent (and diverge)
  rendering.

## Chosen Approach

C (extract component **and** tokens to single spliced sources) + distributed
per-ticket guards + a foundational `05b` for `_render(state)`, plus a
dependency reorder so drift-creating interleavings can't happen.

## Architecture (epic restructure)

| Piece | Change |
|---|---|
| **05** | Single component source **and** single token source, spliced by `build.mjs` into component / renderer / viewer / landing. Owns the build-idempotency guard. **Hard predecessor of 01, 03, 04, 06.** |
| **05b (new)** | Establish `_render(state)`: the one place UI derives from state; handlers mutate state only. Lands right after 05. Predecessor of 01, 03, 06. |
| **01 / 03 / 06** | Fix the bug by routing through state → `_render`, not another imperative DOM poke. Each keeps its own disconfirming guard. |
| **02 / 07 / 08** | Unchanged root causes; each gains the stated "owns its guard" criterion. |
| **~~10~~** | Not created. Responsibility distributed. |
| **Epic 00** | New "Principles applied" section naming the through-line (single source of truth + `ui = fn(state)`). Update the dependency table/notes for the reorder. |
| **09** | Carve-out to "no opportunistic refactor": DRY-ing the region a ticket *touches* is in-scope; the 05-first ordering keeps each behavior diff single-file. |

## Data flow

State → `_render(state)` → DOM. Handlers write state and re-render; they never
set label/timer/error imperatively. Tokens: one source → build splices → four
consumers. Component: one source → build splices → `docs/index.html`.

## Error handling

The build-idempotency guard is the failure surface: if source and generated
output disagree (hand-edit, skipped rebuild, or a token added in the wrong
place), `npm test` fails with the offending diff. Per-ticket disconfirming
inputs remain the failure surface for each behavior regression.

## Testing strategy

- **Unit/build:** idempotency test (05); token single-source assertion (05).
- **Component (jsdom/e2e):** `_render(state)` derivation (05b); each behavior
  ticket's disconfirming guard (01/03/04/06).
- **e2e:** outcome assertions per 08 (bounding-box visibility, real failure
  path, non-empty picker).
- Everything gates through `npm test`; no manual "verified visually".

## Principles Applied

- **Single Source of Truth** — 05 collapses two component copies and four token
  copies to one each; 07 moves the CSS rule into the always-injected blob; 08
  removes production-code copies from tests. Enforced by the build-idempotency
  guard, not discipline.
- **UI = fn(state)** — 05b makes rendering a pure function of state; 01/03/06
  become structurally impossible rather than individually patched.
- **Separation of Concerns** — handlers mutate state; `_render` owns DOM; the
  build owns generated output.
- **Distributed responsibility over central enforcement** — each ticket carries
  its own DRY-up and disconfirming guard; no separate policing ticket.
- **YAGNI, revisited** — the epic deferred token extraction on YAGNI grounds;
  the "extract now" (C) call overrides that because drift is already costing
  real agent work (the 01 double-application), not hypothetical.

## Open Questions

- Does the token extraction risk visual regressions across the four consumers?
  Mitigation: idempotency test + a rendered-report fixture diff.
- Should 01's already-done (doubled) work be reverted first, or absorbed when 05
  splices? Leaning: revert, redo against single source post-05.
