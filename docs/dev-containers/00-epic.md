# Dev containers for OpenJam — spike epic

**Issue:** [#38](https://github.com/SaintPepsi/openjam/issues/38)
**Type:** desk research spike, plus one hands-on trial of the plain devcontainer
(scope extended 2026-07-17; evidence in 01)

## Goal

Pick a containerised development setup that lets multiple isolated instances (human or
AI agent) work on OpenJam in parallel: no shared node_modules, no branch stomping, no
data bleeding. Evaluate two independent axes, then recommend a combined stack.

## Constraint

The full suite (`npm test`, `package.json:9`) builds with esbuild, runs bun unit tests,
and runs Playwright e2e loading the real unpacked MV3 extension in headless Chrome. Any
candidate must plausibly support that. Precedent: `test:snapshots` (`package.json:12`)
already runs the Playwright suite inside `mcr.microsoft.com/playwright:v1.60.0-jammy`.

## Children

| Doc | Axis | Status |
| --- | --- | --- |
| [01-container-environment.md](01-container-environment.md) | Axis 1 — container environment (incl. option 1 trial evidence) | done |
| [02-parallel-isolation.md](02-parallel-isolation.md) | Axis 2 — parallel isolation model | done |
| [03-recommendation.md](03-recommendation.md) | Combined stack + follow-up issue contents | done |

## Out of scope

- Landing `.devcontainer/` (follow-up implementation issue)
- The reusable "containerise any repo" skill (PAI-side)
