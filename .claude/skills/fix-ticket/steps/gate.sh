#!/bin/sh
# gate.sh — generic gate dispenser, installed by gatify.
#
# Lives at <skill>/steps/gate.sh and parses the ordered list in ../SKILL.md,
# which stays the single source of sequence. Records gate passages, with
# evidence, in a per-run state file and hands out the next step.
#
# Usage:
#   steps/gate.sh init    <RUN_ID>                      # create the state file, print step 0
#   steps/gate.sh advance <RUN_ID> <step> "<evidence>"  # record a gate pass, print the next step
#   steps/gate.sh note    <RUN_ID> "<text>"             # record a decision/triage note
#   steps/gate.sh status  <RUN_ID>                      # show recorded passes + the next step
#
# RUN_ID names one run of the workflow (a ticket id, a date, a slug).
# State file: ${GATE_STATE_DIR:-<repo root>/.gate}/<skill>-<RUN_ID>.state.md
# Add `.gate/` to .gitignore — run state is local working data.
#
# `advance` refuses to record step N unless step N-1 is already recorded
# (step 0 excepted). Re-recording an earlier step is a loop re-entry and is
# always allowed once its predecessor has passed.

set -eu

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SKILL_MD="$SKILL_DIR/SKILL.md"
SKILL_NAME="$(basename "$SKILL_DIR")"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
STATE_DIR="${GATE_STATE_DIR:-$ROOT/.gate}"

usage() { sed -n '2,20p' "$0"; exit 1; }

[ $# -ge 2 ] || usage
CMD=$1
RUN=$2
STATE="$STATE_DIR/$SKILL_NAME-$RUN.state.md"
NOW=$(date '+%Y-%m-%d %H:%M')

step_line() { grep -E "^$1\. \*\*" "$SKILL_MD" || true; }

max_step() { grep -E '^[0-9]+\. \*\*' "$SKILL_MD" | sed 's/\..*//' | sort -n | tail -1; }

first_step() { grep -E '^[0-9]+\. \*\*' "$SKILL_MD" | sed 's/\..*//' | sort -n | head -1; }

passed() { [ -f "$STATE" ] && grep -q "^- \[gate\] step $1 " "$STATE"; }

# --- optional delegation guard -------------------------------------------------
# A workflow that produces file changes and delegates them to subagents can opt in
# by putting `<!-- gate:guard-from N -->` in its SKILL.md. From step N+1 on, advance
# then refuses a working-tree change that has no recorded dispatch. Absent = off, so
# existing gatified skills are unaffected.

# Deterministic fingerprint of the working tree: committed HEAD + tracked diff +
# untracked files (-uall lists files inside untracked dirs individually, so a new
# file in an already-untracked dir still registers). Degrades to "none" outside git.
fingerprint() {
  h=$(git rev-parse HEAD 2>/dev/null || echo none)
  d=$( { git diff HEAD 2>/dev/null; git status --porcelain -uall 2>/dev/null; } | git hash-object --stdin 2>/dev/null || echo none )
  printf 'head=%s dirty=%s' "$h" "$d"
}

last_tree() { [ -f "$STATE" ] && grep '^- \[tree\] ' "$STATE" | tail -1 | sed 's/^.*— //'; }

# Release the guard only on an ATTRIBUTION note (a recorded subagent dispatch or loop
# re-entry), not on an unrelated triage note. One-shot: reset at each [tree] line.
attribution_since_last_tree() {
  [ -f "$STATE" ] || return 1
  awk '
    /^- \[tree\] /{seen=1; attr=0}
    /^- \[note\] /{
      if(seen){t=$0; sub(/^.*— /,"",t); t=tolower(t);
        if(t ~ /^(dispatch|re-entry|subagent):/) attr=1}
    }
    END{exit !attr}' "$STATE"
}

guard_from() { grep -oE '<!-- *gate:guard-from *[0-9]+ *-->' "$SKILL_MD" 2>/dev/null | grep -oE '[0-9]+' | head -1; }

print_next() {
  next=$(( $1 + 1 ))
  if [ "$next" -gt "$(max_step)" ]; then
    echo "Workflow complete — all gates recorded in $STATE."
  else
    echo "NEXT STEP:"
    step_line "$next"
  fi
}

case "$CMD" in
  init)
    mkdir -p "$STATE_DIR"
    if [ -f "$STATE" ]; then
      echo "State file already exists: $STATE"
    else
      printf '# %s — run %s\n\nGate log (written by steps/gate.sh).\n\n' "$SKILL_NAME" "$RUN" > "$STATE"
      echo "Initialized $STATE"
    fi
    echo "NEXT STEP:"
    step_line "$(first_step)"
    ;;
  advance)
    [ $# -eq 4 ] || usage
    STEP=$3
    EVIDENCE=$4
    [ -f "$STATE" ] || { echo "ERROR: no state file for run $RUN — run: steps/gate.sh init $RUN" >&2; exit 1; }
    [ -n "$EVIDENCE" ] || { echo "ERROR: a gate pass needs evidence — one concrete line of proof." >&2; exit 1; }
    if [ "$STEP" -gt "$(first_step)" ] && ! passed $(( STEP - 1 )); then
      echo "ERROR: step $(( STEP - 1 )) has no recorded gate pass — the gate for step $STEP stays shut." >&2
      exit 1
    fi
    gf=$(guard_from)
    if [ -n "$gf" ] && [ "$STEP" -gt "$gf" ]; then
      prev=$(last_tree)
      if [ -n "$prev" ] && [ "$(fingerprint)" != "$prev" ] && ! attribution_since_last_tree; then
        echo "ERROR: working tree changed since the last gate with no recorded dispatch — hands-on edits bypass the pipeline. Delegate the change, or record it: steps/gate.sh note $RUN \"dispatch: <why>\"" >&2
        exit 1
      fi
    fi
    printf -- '- [gate] step %s — PASSED @ %s — evidence: %s\n' "$STEP" "$NOW" "$EVIDENCE" >> "$STATE"
    printf -- '- [tree] step %s — %s\n' "$STEP" "$(fingerprint)" >> "$STATE"
    echo "Recorded: step $STEP passed."
    print_next "$STEP"
    ;;
  note)
    [ $# -eq 3 ] || usage
    [ -f "$STATE" ] || { echo "ERROR: no state file for run $RUN — run: steps/gate.sh init $RUN" >&2; exit 1; }
    printf -- '- [note] @ %s — %s\n' "$NOW" "$3" >> "$STATE"
    echo "Noted."
    ;;
  status)
    [ -f "$STATE" ] || { echo "No state file for run $RUN — run: steps/gate.sh init $RUN"; exit 0; }
    cat "$STATE"
    last=$(grep '^- \[gate\] step ' "$STATE" | sed 's/^- \[gate\] step \([0-9]*\).*/\1/' | sort -n | tail -1)
    print_next "${last:--1}"
    ;;
  *) usage ;;
esac
