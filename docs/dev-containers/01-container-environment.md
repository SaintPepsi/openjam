# Axis 1 — Container environment

> Part of [00-epic.md](00-epic.md). Desk research only; unverified claims are marked as
> open questions at the bottom.

## Option 1 — Plain `devcontainer.json`

A minimal in-repo config: base image + OpenJam's toolchain, nothing agent-specific.

**What it looks like.** `mcr.microsoft.com/playwright:v1.60.0-jammy` as base (already
proven to run the full suite: `test:snapshots`, `package.json:12`) plus bun. Claude Code
is one line via the official Dev Container Feature
(`ghcr.io/anthropics/devcontainer-features/claude-code:1.0`), per
[the Claude Code devcontainer docs](https://code.claude.com/docs/en/devcontainer).

**Pros**

- Smallest setup and maintenance surface; standard spec, works in VS Code, JetBrains,
  Cursor, Codespaces ([containers.dev](https://containers.dev/)).
- The Playwright base image ships every browser dependency; only bun needs adding.
- Composes with codebay (it consumes an existing `.devcontainer/`,
  [codebay README](https://github.com/khromov/codebay)).
- The Claude Code feature also installs the VS Code extension when opened in VS Code.

**Cons**

- No network egress control. The docs warn that with `--dangerously-skip-permissions`
  a malicious project can exfiltrate anything reachable in the container, including
  `~/.claude` credentials
  ([docs, warning box](https://code.claude.com/docs/en/devcontainer)). Unattended
  parallel agents without a firewall means unrestricted outbound network.
- Auth persistence across rebuilds is DIY (though the docs give the recipe: named
  volume at `~/.claude`).

## Option 2 — Anthropic reference Claude Code devcontainer

The [reference `.devcontainer/`](https://github.com/anthropics/claude-code/tree/main/.devcontainer)
from `anthropics/claude-code`: `devcontainer.json` + `Dockerfile` + `init-firewall.sh`.
The docs position it as "a working example rather than a maintained base image"
([docs](https://code.claude.com/docs/en/devcontainer)).

**What it provides** (read from the actual files, 2026-07-17):

- `Dockerfile`: `node:20` base, dev tools (git, gh, fzf, zsh, git-delta, jq), Claude
  Code installed globally via npm, non-root `node` user.
- `devcontainer.json`: named volumes for `~/.claude` and shell history keyed by
  `${devcontainerId}` (so parallel containers don't share state), workspace bind mount,
  `NET_ADMIN`/`NET_RAW` capabilities, firewall run as `postStartCommand`.
- `init-firewall.sh`: default-DROP iptables + ipset allowlist — GitHub IP ranges
  (fetched live from `api.github.com/meta`), `registry.npmjs.org`, `api.anthropic.com`,
  sentry/statsig telemetry, VS Code marketplace. Self-verifies by asserting
  `https://example.com` is unreachable and `https://api.github.com` is reachable.

**Pros**

- The firewall is the piece that makes unattended `--dangerously-skip-permissions`
  agents defensible: a compromised or prompt-injected session can only reach
  allowlisted domains.
- Persistence and per-container isolation of `~/.claude` are already solved, and the
  `${devcontainerId}` volume naming is parallel-friendly by construction.
- Non-root user means the CLI's root-rejection of `--dangerously-skip-permissions`
  doesn't bite.

**Cons**

- Not maintained as a base image; we own the fork from day one.
- Needs real adaptation for OpenJam: no bun, no Playwright system deps in the
  Dockerfile, and the firewall allowlist would block Playwright's browser CDN and
  bun's install endpoint at runtime. Mitigation: bake browsers into the image at build
  time (the firewall only starts at `postStartCommand`, so build-time downloads are
  unaffected) and extend the allowlist for anything needed at runtime.
- Firewall resolves domains to IPs once at container start; IP rotation or CDNs with
  large dynamic ranges can break the allowlist mid-session (inference from the script's
  resolve-once design, not documented).
- Requires `NET_ADMIN`/`NET_RAW` container capabilities.

## Option 3 — Docker Sandboxes (`docker sandbox` / sbx)

Docker's agent-sandboxing product: each sandbox is a microVM with its own kernel,
filesystem, and Docker daemon. GA since 2026-01-30
([Docker blog](https://www.docker.com/blog/docker-sandboxes-run-claude-code-and-other-coding-agents-unsupervised-but-safely/),
[docs](https://docs.docker.com/ai/sandboxes/)).

**What it provides**

- MicroVM isolation (own kernel, VM boundary) — categorically stronger than container
  isolation; the agent can even run Docker inside without touching the host daemon.
- First-class agent support (Claude Code, Codex, Copilot, Gemini) with credential
  injection, and network policies with allow/deny lists ("Balanced" mode allows AI
  services, package managers, code repos).
- Native parallel workflow: `--branch` mode creates git worktrees under `.sbx/` so
  multiple sandboxes work the same repo concurrently
  ([Andrew Lock's writeup](https://andrewlock.net/running-ai-agents-safely-in-a-microvm-using-docker-sandbox/)).
- "Kits": YAML templates declaring tools, env vars, credentials, allowed domains.
- `sbx` CLI free including commercial use; org governance features are paid.

**Cons**

- macOS (arm64) and Windows only; Linux "planned"
  ([Docker blog](https://www.docker.com/blog/docker-sandboxes-run-claude-code-and-other-coding-agents-unsupervised-but-safely/)).
  That rules it out for Linux CI or Linux-hosted runners today.
- Not the devcontainer spec: config lives in Docker's kit format, so it does not
  compose with codebay and there's no editor "reopen in container" flow. It's a
  host-side wrapper, not an in-repo artifact — nothing lands in the OpenJam repo, so
  the environment isn't reproducible for contributors from the repo alone.
- Reported friction: performance degradation, "Balanced" network mode too strict for
  docs sites, agents can still corrupt the mounted `.git`
  ([Andrew Lock](https://andrewlock.net/running-ai-agents-safely-in-a-microvm-using-docker-sandbox/)).
- Newest of the three; GA'd under six months ago.

## Trial evidence — option 1 (2026-07-17)

Hands-on trial of the plain devcontainer, upgrading option 1's pros/cons from desk
claims to evidence. Config used (`.devcontainer/devcontainer.json` on the spike
branch): `mcr.microsoft.com/playwright:v1.60.0-jammy` + claude-code feature 1.0 +
`postCreateCommand: npm install -g bun && npm ci`, brought up with
`@devcontainers/cli` 0.87.0 on Docker 29.2.1.

**Result: full suite passes inside the container.**

- `bun test test/`: `90 pass, 0 fail, 234 expect() calls, 13 files`
- `playwright test`: `37 passed (41.1s)` — including the unpacked-MV3-extension e2e
  and the full-page pixel baseline, so container Chrome matches the committed
  snapshots (expected, since `test:snapshots` generates them in the same image).
- Toolchain inside: node v24.15.0, bun 1.3.14, Playwright 1.60.0. The claude-code
  feature installed cleanly alongside.

**Friction found (fixes for the real config):**

1. `npm ci` inside the container rewrote the host's `node_modules` through the bind
   mount with Linux binaries; the host needed `npm ci` again afterwards. Fix: mount a
   volume over `node_modules`, exactly as `test:snapshots` already does
   (`package.json:12`).
2. The Playwright image runs as root and the devcontainer inherited
   `remoteUser: root`. Claude Code rejects `--dangerously-skip-permissions` as root,
   so unattended-agent use needs a non-root `remoteUser` (the image ships `pwuser`).
3. Open questions 1–3 below are now answered (bun: yes; `npm test`: passes; snapshot
   parity: yes). Question 4 (firewall + OAuth callback) remains — the firewall layer
   wasn't part of this trial.

## Composable-layer mapping

How each option decomposes into the layers a future "containerise this project" skill
would offer:

| Layer | Option 1 | Option 2 | Option 3 |
| --- | --- | --- | --- |
| base (toolchain) | Playwright image + bun | fork Dockerfile, add deps | kit YAML tools |
| +claude-code | official feature, 1 line | baked into Dockerfile | built-in agent support |
| +firewall | not included | `init-firewall.sh` + capabilities | network policies (built-in) |
| +parallelism | BYO (axis 2) | `${devcontainerId}` volumes help | `--branch` worktrees (built-in) |
| +credentials | BYO volume mount | `~/.claude` volume solved | credential injection (built-in) |

Options 1 and 2 are the same artifact at different layer counts: option 2 ≈ option 1 +
firewall + credentials layers. Option 3 is a different plane entirely (host-side, not
in-repo) and can wrap either.

## Axis 1 leaning (to confirm after axis 2)

Start from option 1 fitted to OpenJam (Playwright base image + bun + claude-code
feature), then graft option 2's firewall and volume layers with an extended allowlist.
That keeps the in-repo artifact standard and codebay-composable while getting the
egress control that makes unattended agents defensible. Docker Sandboxes stays a
possible personal host-side wrapper, not the repo's answer — it leaves nothing
reproducible in the repo and excludes Linux hosts.

## Open questions for the follow-up PoC

- Does bun install/run cleanly in the jammy-based Playwright image alongside the
  claude-code feature?
- Exact extra allowlist domains needed at runtime (Anthropic auth flow, npm audit,
  anything Playwright touches when browsers are pre-baked)?
- Does headless extension e2e behave identically under the container's Chrome vs the
  host runs (snapshot diffs)?
- Firewall + VS Code port-forwarding for the OAuth callback: docs note the callback
  can fail and require manual code paste — how annoying is that in practice?
