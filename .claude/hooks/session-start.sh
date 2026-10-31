#!/usr/bin/env bash
# SessionStart: print the plan's "Now" section so every session (including
# after /clear or /compact) starts from the recorded state.
set -uo pipefail

root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
plan="$root/docs/private/plan.md"

echo "Scryguard state from docs/private/plan.md. Treat it as the baseline."
if [[ -f "$plan" ]]; then
  sed -n '/^## Now/,/^## Rules/p' "$plan" | sed '$d'
else
  echo "(plan missing)"
fi

unlock="$root/.claude/unlocked-paths"
if [[ -f "$unlock" ]] && grep -qvE '^\s*(#|$)' "$unlock"; then
  echo; echo "Unlocked for Claude edits:"
  grep -vE '^\s*(#|$)' "$unlock"
fi
exit 0
