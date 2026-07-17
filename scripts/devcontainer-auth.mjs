#!/usr/bin/env node
// Vendored from https://github.com/SaintPepsi/containerise-dev — the skill
// repo is the canonical source; report issues and improvements there.
//
// Authorize Claude Code inside a devcontainer using the host's existing
// sign-in, so `claude` in the container terminal starts without a fresh
// login. Credential transport adapted to devcontainer lifecycle hooks (a
// devcontainer has no host-side daemon to exec into the container, so the
// credentials pass through a gitignored staging file):
//
//   --stage    host, via initializeCommand: locate credentials (macOS
//              Keychain, then ~/.claude/.credentials.json) and stage them at
//              .devcontainer/.claude-creds.json (gitignored, mode 600).
//              Exits 0 when absent so container builds never break.
//   --install  container, via postCreateCommand: move the staged file to
//              $CLAUDE_CONFIG_DIR/.credentials.json (default ~/.claude) and
//              mark onboarding complete, then delete the staged file.
//   (no flag)  host, one-shot: inject into an already-running container over
//              stdin via `devcontainer exec` — no staging file involved.
//
// CONTAINERISE_STAGED_FILE overrides the staged-file path (tests only).
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const KEYCHAIN_SERVICE = 'Claude Code-credentials';
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function stagedFilePath() {
  return process.env.CONTAINERISE_STAGED_FILE || join(repoRoot, '.devcontainer', '.claude-creds.json');
}

// Safe single-file delete: only ever called with the staged-file path;
// tolerates the file already being gone.
function unlinkFile(path) {
  if (!path || !existsSync(path)) return;
  try {
    unlinkSync(path);
  } catch (err) {
    console.warn(`devcontainer-auth: could not remove ${path}: ${err.message}`);
  }
}

export function isValid(json) {
  try {
    return Boolean(JSON.parse(json)?.claudeAiOauth?.accessToken);
  } catch {
    return false;
  }
}

export function locateHostCredentials() {
  if (process.platform === 'darwin') {
    const out = spawnSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], {
      encoding: 'utf8',
    });
    const creds = (out.stdout ?? '').trim();
    if (out.status === 0 && isValid(creds)) return { creds, source: `macOS Keychain ("${KEYCHAIN_SERVICE}")` };
  }
  const file = join(homedir(), '.claude', '.credentials.json');
  if (existsSync(file)) {
    const raw = readFileSync(file, 'utf8').trim();
    if (isValid(raw)) return { creds: raw, source: file };
  }
  return null;
}

export function stage() {
  const found = locateHostCredentials();
  if (!found) {
    console.log('devcontainer-auth: no host Claude Code credentials; container will need a manual `claude` sign-in.');
    return 0;
  }
  writeFileSync(stagedFilePath(), found.creds, { mode: 0o600 });
  console.log(`devcontainer-auth: staged credentials from ${found.source}.`);
  return 0;
}

// Runs inside the container: ~ is the container user's home.
export function install() {
  const staged = stagedFilePath();
  if (!existsSync(staged)) {
    console.log('devcontainer-auth: no staged credentials; run `claude` to sign in manually.');
    return 0;
  }
  const creds = readFileSync(staged, 'utf8');
  const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, '.credentials.json'), creds, { mode: 0o600 });
  // hasCompletedOnboarding is what stops `claude` re-running its first-run
  // setup/login wizard.
  const configFile = process.env.CLAUDE_CONFIG_DIR
    ? join(process.env.CLAUDE_CONFIG_DIR, '.claude.json')
    : join(homedir(), '.claude.json');
  writeFileSync(configFile, JSON.stringify({ hasCompletedOnboarding: true }));
  chmodSync(configFile, 0o644);
  unlinkFile(staged);
  console.log(`devcontainer-auth: Claude Code authorized (${join(configDir, '.credentials.json')}).`);
  return 0;
}

export function injectRunning() {
  const found = locateHostCredentials();
  if (!found) {
    console.error('No Claude Code credentials found on host. Run `claude` and sign in on the host first.');
    return 1;
  }
  console.log(`Found host credentials in ${found.source}; injecting into the devcontainer…`);
  const script =
    'h=$(eval echo ~$(id -un)); d="${CLAUDE_CONFIG_DIR:-$h/.claude}"; mkdir -p "$d"; ' +
    'umask 077; cat > "$d/.credentials.json"; ' +
    'cfg="${CLAUDE_CONFIG_DIR:+$CLAUDE_CONFIG_DIR/.claude.json}"; cfg="${cfg:-$h/.claude.json}"; ' +
    'printf %s \'{"hasCompletedOnboarding":true}\' > "$cfg"; chmod 644 "$cfg"; ' +
    'echo "authorized: $d/.credentials.json"';
  const res = spawnSync(
    'npx',
    ['--yes', '@devcontainers/cli', 'exec', '--workspace-folder', repoRoot, 'bash', '-c', script],
    { input: found.creds, stdio: ['pipe', 'inherit', 'inherit'] },
  );
  return res.status ?? 1;
}

// Main-module guard that survives symlinked skill directories (first-trial
// finding: argv[1] may be the symlinked path while import.meta.url is real).
function isMain() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  const mode = process.argv[2];
  if (mode === '--stage') process.exit(stage());
  else if (mode === '--install') process.exit(install());
  else process.exit(injectRunning());
}
