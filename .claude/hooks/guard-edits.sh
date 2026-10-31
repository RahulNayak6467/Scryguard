#!/usr/bin/env bash
# PreToolUse guard: the user writes application code, the sandbox image,
# core Terraform and the Python tools. Claude may edit tests, docs, config,
# tooling, the AI-written dashboard, glue infra, its own setup, and paths
# the user lists in .claude/unlocked-paths.
set -euo pipefail

root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
path=$(jq -r '.tool_input.file_path // .tool_input.notebook_path // empty')
[[ -z "$path" ]] && exit 0

case "$path" in
  "$root"/*) rel="${path#"$root"/}" ;;
  *) exit 0 ;;
esac

case "$rel" in
  .claude/unlocked-paths | .claude/hooks/* | .claude/settings.json)
    echo "Blocked: '$rel' controls the edit guard. Only the user changes it." >&2
    exit 2 ;;
  docs/private/notes/*)
    echo "Blocked: '$rel' is the user's notes. Suggest the text instead." >&2
    exit 2 ;;
esac

unlock="$root/.claude/unlocked-paths"
if [[ -f "$unlock" ]]; then
  while IFS= read -r prefix || [[ -n "$prefix" ]]; do
    prefix="${prefix%%#*}"; prefix="${prefix//[[:space:]]/}"
    [[ -n "$prefix" && "$rel" == "$prefix"* ]] && exit 0
  done < "$unlock"
fi

case "$rel" in
  *.test.ts | test/* | */test/* | tests/* | \
  docs/* | .claude/* | CLAUDE.md | README.md | */README.md | \
  package.json | */package.json | tsconfig*.json | */tsconfig*.json | pnpm-workspace.yaml | \
  eslint.config.* | vitest.config.* | */vitest.config.* | .prettierrc* | .prettierignore | \
  .nvmrc | .npmrc | .gitignore | .gitleaks.toml | .env.example | .env.test.example | */.env.example | \
  docker-compose*.yml | .github/* | */openapi.json | scripts/* | \
  apps/dashboard/* | \
  infra/toxiproxy/* | infra/k6/* | infra/dashboards/* | \
  infra/terraform/modules/alarms/* | infra/terraform/modules/budgets/* | \
  evals/datasets/* | evals/reports/*)
    exit 0 ;;
esac

echo "Blocked: '$rel' is the user's code (learn mode, the sandbox image, core Terraform or the Python tools). Explain the change instead, or ask the user to add the path to .claude/unlocked-paths." >&2
exit 2
