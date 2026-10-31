#!/usr/bin/env bash
# Refuses a commit that mixes private paths with public ones, so private
# files never end up inside a commit that stays in the public history.
set -euo pipefail

private_re='^(CLAUDE\.md|\.claude/|docs/private/)'
staged=$(git diff --cached --name-only)
[[ -z "$staged" ]] && exit 0

private=$(grep -E "$private_re" <<<"$staged" || true)
public=$(grep -vE "$private_re" <<<"$staged" || true)

if [[ -n "$private" && -n "$public" ]]; then
  echo "Commit blocked: it mixes private and public files." >&2
  echo "Private:" >&2; sed 's/^/  /' <<<"$private" >&2
  echo "Public:" >&2; sed 's/^/  /' <<<"$public" >&2
  echo "Commit them separately, e.g. 'git restore --staged <public files>' first." >&2
  exit 1
fi
exit 0
