# Axis 2 — Parallel isolation model

> Part of [00-epic.md](00-epic.md). Desk research; inference is flagged as inference.
> OpenJam context that simplifies everything here: the suite binds no host ports and
> needs no shared services (Playwright runs Chrome headless in-container, proven in
> [01-container-environment.md](01-container-environment.md#trial-evidence--option-1-2026-07-17)),
> so the service-routing machinery some parallel-worktree guides need (Traefik,
> compose profiles — [kenfdev's setup](https://blog.kenev.net/en/posts/parallel-dev-devcontainer-git-worktree/))
> does not apply.

## Option 1 — Worktree-per-container

One git worktree per instance, each container mounting its own worktree.

**Why clashes can't happen**

- Git refuses to check out the same branch in two worktrees — branch stomping is
  prevented by construction.
- All worktrees share one object store (the main repo's `.git`), so instances are
  cheap: no re-clone, and finished work is just a local branch merge away — no
  push/pull roundtrip.
- The container boundary isolates runtime state; `node_modules` needs a
  **per-instance named volume** (unique name per worktree) or instances would fight
  over it.

**The known trap: the worktree's `.git` is a file, not a directory.** It points at
`<main-repo>/.git/worktrees/<name>` by absolute host path. Mount only the worktree
and git inside the container fails with `fatal: not a git repository`
([GitWorktree.org guide](https://www.gitworktree.org/guides/devcontainer)). Known
fixes:

1. Mount the common parent directory so the pointer resolves (most common fix, but
   the container then sees sibling worktrees).
2. Symlink shim inside the container redirecting the host path
   ([kenfdev](https://blog.kenev.net/en/posts/parallel-dev-devcontainer-git-worktree/),
   [therightstuff](https://therightstuff.medium.com/playing-nicely-with-git-worktrees-and-devcontainers-3abde3ce1e8a)).
3. The devcontainer CLI / VS Code have **experimental** worktree support that
   auto-mounts the main `.git` — but it silently doesn't when `workspaceMount` is
   customized ([devcontainers/cli#796](https://github.com/devcontainers/cli/issues/796),
   [vscode-remote-release#11478](https://github.com/microsoft/vscode-remote-release/issues/11478)).

**Pros:** cheapest per instance (disk + time); work flows back through normal local
git; branch-collision safety built in.
**Cons:** the `.git` mount workaround is real setup cost and the official support is
experimental; per-instance volume naming is on us.

## Option 2 — Copy/clone-per-container

Each instance gets a full copy or fresh clone in its own volume.

**Pros:** total isolation — no shared `.git`, no mount tricks, nothing experimental;
an agent corrupting its repo corrupts only its copy.
**Cons:** work leaves only via `git push` (needs a token in every instance); disk and
setup time per instance (a full OpenJam checkout + `node_modules` + report fixtures
per copy); easy to accumulate stale copies.

## Option 3 — Managed layer: codebay

[codebay](https://github.com/khromov/codebay) manages fleets of devcontainer
instances with a web UI. From its README:

- **Isolation model is copy-per-instance** (option 2 automated): it copies the
  project into `~/.codebay`, injects code-server into the copy's
  `devcontainer.json`, and runs `devcontainer up` on it.
- **Work egress:** no sync-back mechanism is documented; with git config + `gh auth
  token` + Claude Code OAuth credentials injected into every instance, the intended
  path is push from inside (inference — verify in a follow-up PoC).
- **Ports:** code-server per instance on a unique host port behind a local proxy.
  Irrelevant to OpenJam's test suite, which binds nothing.
- **Requirements:** bun ≥ 1.3.13, Docker, macOS or Linux (Windows untested; Node.js
  explicitly unsupported).
- **Composes with axis 1:** it respects an existing `.devcontainer/` and won't
  modify tooling; the repo config must make `claude` available itself — which the
  claude-code feature in our trial config already does.

**Pros:** parallelism, credentials, and editor access solved with a UI; zero repo
changes beyond the `.devcontainer/` we'd ship anyway.
**Cons:** inherits copy-model costs (disk, push-to-exit); young project, no
versioning/roadmap signals in the README; adds a host-side dependency on bun +
codebay itself.

## Cross-cutting concerns

- **Claude Code auth across N instances.** Codebay copies host credentials into each
  instance. The DIY equivalent is either the same copy trick or the reference
  container's per-instance `~/.claude` volume (`${devcontainerId}`-keyed) with one
  sign-in per instance; a `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token` avoids
  repeated browser logins ([docs](https://code.claude.com/docs/en/devcontainer)).
- **Credential blast radius.** Anything injected into an instance is exfiltratable by
  a compromised unattended session (docs warning, 01 option 1 cons). Worktree mode
  needs *no* push token for work to flow back — a real security edge over
  copy-based models when running `--dangerously-skip-permissions`.
- **Personal files.** Gitignored files ride along differently per model. A fresh
  worktree contains only tracked files, so personal host artifacts (e.g.
  `.claude/settings.local.json`, which we found carrying absolute host paths into
  the trial container via the bind mount) stay out of agent instances by
  construction. Copy-per-instance models (codebay) copy the folder wholesale,
  gitignored personal files included.
- **Disk.** Worktree: one object store + checkout per instance. Copy: full project
  per instance. With `node_modules` and Playwright browsers living in
  volumes/images either way, the delta is the working tree itself — modest for
  OpenJam, but copies also duplicate any local recordings/fixtures.

## Axis 2 leaning

**Worktree-per-container as the documented default; codebay as an optional manager,
not a dependency.** Worktrees are the cheapest, keep work flowing back without
granting push credentials to agent containers, and the `.git` gotcha has
well-understood fixes we'd document once. Codebay replaces the worktree layer (its
copy model makes worktrees unnecessary inside it) rather than stacking on it — both
consume the same `.devcontainer/`, so shipping a codebay-compatible config keeps that
door open at zero cost.

## Open questions for the follow-up PoC

- Verify codebay's work-egress path (push from inside?) and what happens to
  uncommitted work when an instance is deleted.
- Which `.git` fix (parent mount vs symlink shim vs experimental CLI support) is
  least annoying with our config in practice.
- Does the claude-code feature's sign-in flow work under codebay's injected
  credentials without a browser roundtrip per instance.
