# Recommendation — combined stack

> Part of [00-epic.md](00-epic.md). Closes the spike for
> [#38](https://github.com/SaintPepsi/openjam/issues/38).

## The stack

**Axis 1:** plain devcontainer fitted to OpenJam, with the reference container's
firewall and volume layers grafted on.
**Axis 2:** worktree-per-container as the documented default; codebay-compatible by
construction, adopted (or not) per-person on the host side.

Concretely, `.devcontainer/` ships:

- **Base:** `mcr.microsoft.com/playwright:v1.60.0-jammy` + bun + the claude-code
  feature. Evidence, not hope: the exact trial config passed the full suite
  (90/90 unit, 37/37 e2e including the pixel baseline —
  [01 trial evidence](01-container-environment.md#trial-evidence--option-1-2026-07-17)).
- **Fixes from trial friction:** named volume over `node_modules` (per-instance
  name), non-root `remoteUser` (`pwuser`) so unattended agent mode isn't rejected.
- **From the reference container:** `init-firewall.sh` (allowlist extended for
  anything the toolchain needs at runtime; browsers baked in at build time),
  `NET_ADMIN`/`NET_RAW` runArgs, `${devcontainerId}`-keyed `~/.claude` volume.
- **Docs:** a short worktree-per-container recipe (the `.git`-file fix we settle on,
  volume naming), and a note that codebay users just point it at the repo.

## Why this combination

- The trial proved the cheap 80% works today; the firewall is the only piece that
  makes unattended `--dangerously-skip-permissions` agents defensible
  ([01, option 2](01-container-environment.md#option-2--anthropic-reference-claude-code-devcontainer)).
- Worktrees keep parallel work cheap and flowing back via local merges — no push
  token inside agent containers, shrinking the credential blast radius
  ([02, cross-cutting](02-parallel-isolation.md#cross-cutting-concerns)).
- Everything is standard devcontainer spec: works in VS Code/JetBrains/Codespaces,
  consumed as-is by codebay, and Docker Sandboxes can still wrap it host-side for
  anyone on macOS who wants microVM isolation
  ([01, option 3](01-container-environment.md#option-3--docker-sandboxes-docker-sandbox--sbx)).

## What the follow-up implementation issue should contain

1. Harden the trial `.devcontainer/` (volume over `node_modules`, `remoteUser:
   pwuser`, `~/.claude` volume).
2. Graft + adapt `init-firewall.sh`; verify `npm test` and a `claude` session run
   under the firewall (PoC question 4 from 01).
3. Settle the worktree `.git` fix (parent mount vs symlink shim vs experimental CLI
   support) and document the recipe ([02 open questions](02-parallel-isolation.md#open-questions-for-the-follow-up-poc)).
4. Verify codebay compatibility once: instance up, `claude` authenticated, work
   pushed out ([02 open questions](02-parallel-isolation.md#open-questions-for-the-follow-up-poc)).
5. Acceptance criteria per repo convention: each = command + output or `file:line`,
   with a disconfirming case (e.g. firewall up → `curl https://example.com` fails).

## Known unknowns (deliberately left to the PoC)

- Extra firewall allowlist domains needed at runtime (Anthropic auth flow, npm).
- OAuth callback behaviour through editor port-forwarding under the firewall.
- Codebay work-egress mechanics and deletion semantics for uncommitted work.
