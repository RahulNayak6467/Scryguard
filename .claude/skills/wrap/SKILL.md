---
name: wrap
description: Close a Scryguard session. Log hours, update the plan, apply the cut rules, run a commit safety check and propose commit messages.
argument-hint: "[optional: notes]"
disable-model-invocation: true
---

Close the session so the next one needs nothing from chat history. Notes:
$ARGUMENTS. Base everything on `git status` and `git diff`, not memory. If
hours or hosted-model spend aren't clear, ask in one line.

# 1. Update `docs/private/plan.md`

- **Now:** rewrite it (current phase, status line, next step, open
  questions). Keep it under 12 lines.
- **Phases table:** add this session's theory and build hours to the phase's
  actual columns.
- **Log:** append one line:
  `YYYY-MM-DD · T <h> · B <h> · <what got done> · Hosted $<spent>`
- Decisions the user agreed to that had real alternatives: draft an ADR in
  `docs/adr/NNNN-title.md` (Context, Decision, Consequences, Alternatives;
  under ~50 lines) and say so.
- Phase done (its done-when met and the user agrees): mark it, move Now to
  the next phase, and surface its deferred items. Append a short
  **Learned** entry (dated, 2–5 lines: what changed from the notes, what
  to watch for, what was deferred) to the next phase's section in
  `docs/private/design-notes.md`. If a cross-cutting decision changed,
  update §2 and log the reason in `scope.md`'s change log.
- Phase done: also update `README.md` where the finished phase makes
  something newly true. Only real, verified content: no placeholders, no
  planned numbers, no claims ahead of the code. Keep the README's plain
  tone, and never mention private files, Claude or the workflow.

  | Phase done | README change |
  |---|---|
  | 0 | CI status badge; a Getting started section with the commands that actually work |
  | 2 | Configuration: how a repository marks agent-authored pull requests (author accounts, labels, commit trailers) |
  | 3 | Crash-test result in "The interesting parts" (reviews, kills, lost / duplicated / stale counts) |
  | 5 | Screenshot of a real trust report (ask the user for the image, stored under `docs/images/`); one example finding as text, copied from a real run; a Project structure section for the folders that exist; a short Limitations section (languages covered, packages needing install scripts are inconclusive, local-model limits) |
  | 8 | Results table: detection rate and precision per failure type vs the baseline, variance, cost per review; one line on the evaluation method with a link to the full report |
  | 9–11 | Demo GIF or video link (from the user) |
  | 10 | Deployment and cost: Terraform on AWS, the measured monthly cost, $0 per token with local models; link to the deployment section of the architecture page |
  | 11 | Final numbers checked against the reports; links to the demo repository, the SLOs and the drill results; a security note or `SECURITY.md` (how to report a vulnerability); License when the repo goes public; an author line with links (ask the user for them). Remind the user to set the GitHub repo description, topics and website link |

  Milestone releases: after phase 5 (v1) propose tag `v0.1.0`, after phase
  8 `v0.2.0`, after phase 11 `v1.0.0`, each with short release notes from
  the log. Give the `git tag` and `gh release create` commands; never run
  them.

  Show the README diff to the user before the commit. It is a public
  change, so it goes in its own public commit (for example `Add results to
  README`). Tick the matching item in
  `README.md` → Roadmap (`- [ ]` → `- [x]`); it's a public change, so it gets
  its own public commit (e.g. `Mark foundation done in roadmap`).

# 2. Pace and cuts (apply the plan's Rules; don't debate them)

Compare cumulative actual hours with the phase table's cumulative plan at
each checkpoint. If a rule triggers a cut, log it in `docs/private/scope.md`'s
change log with the date and numbers, update the status line, and say so.
Any agreed swap is logged there too. Work done this session that maps to no
scope ID is flagged in the report. Never cut correctness, isolation,
sandbox or concurrency work inside a phase.

Status line, exact prefix (the session hook prints it):
`Status: <on track | behind N h> · cuts: <none | …> · <done> / <planned> h · Hosted $<spent> / $10`

# 3. Commit safety check

Check `git status --porcelain`, `git diff`, `git diff --cached` and
untracked files for: env files other than examples; the GitHub App private
key or any `.pem`; keys, certs, Terraform state or tfvars; build or cache
output; real-looking secrets (AWS `AKIA`, `sk-`, `sk-ant-`, `AIza`, `ghp_`,
`github_pat_`, `ghs_`, webhook secrets, connection strings with passwords);
real repository contents copied into fixtures without a licence check. Show
only `file:line` and a masked value. Anything found is blocking: say how to
fix it and give no commit message until resolved. Otherwise: "Commit check:
clean."

Also check `.gitignore` still covers: `node_modules/`, `dist/`, `coverage/`,
`.next/`, `*.tsbuildinfo`, `.env` and `.env.*` (except the two examples),
`*.pem`, keys and certs, `secrets/`, Terraform state, plans and tfvars,
`.terraform/`, `evals/.cache/`, `tools/python/.venv/`, `__pycache__/`. If
this session added a tool that writes local artifacts (k6 results, MinIO or
ElasticMQ data, sandbox work directories, model caches), propose the
`.gitignore` line. Private local files (`.claude/settings.local.json`,
`.claude/unlocked-paths`) belong in `.git/info/exclude`, never `.gitignore`.

# 4. Commit messages (don't commit)

- Private paths (`docs/private/`, `.claude/`, `CLAUDE.md`): one commit,
  subject `Update progress`.
- Public paths: a separate commit whose subject reads well in a public repo,
  imperative, under ~60 characters, no mention of Claude or the workflow.
- Give the exact `git add` and `git commit` commands, private first.

# 5. Report (4–6 lines)

Commit check, status line, what changed in the plan, next step, the commands.
