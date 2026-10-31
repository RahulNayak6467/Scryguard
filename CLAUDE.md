# Scryguard

Trust gate for pull requests written by AI coding agents. A GitHub App
queues each PR on SQS; a worker runs a LangGraph.js graph (rule-based router
→ four evidence-based specialists → adjudicator) on local models; untrusted
repository code runs only in a sandbox (Docker locally, ECS Fargate on AWS);
verdicts reach GitHub exactly once through an outbox. A learning and resume
project: depth and proof over feature count.

`docs/private/scope.md` is the guardrail: every feature by ID with its spec,
tier and done-when, the cut list, out of scope and the change rule. Work
that maps to no ID is a new feature: flag it at once.
`docs/private/plan.md` holds phases, hours, deadlines, rules and progress;
`docs/private/phases/phase-N.md` the current phase's detailed plan.
`docs/private/design-notes.md` records the product intent, cross-cutting
decisions with their reasons, the interview coverage contract and notes per
phase; `/phase` designs each phase from it.

## Working agreement

- **Two modes.** Every task is *learn* (the user writes the code) or *ship*
  (you write it, the user reads it and must be able to explain it). The tier
  sets the default; the user can override.
- **In learn mode**, don't hand over finished code. Help ladder when the user
  is stuck: nudge (a question) → pattern (approach in words or pseudocode) →
  snippet (small, last resort). Start at nudge unless asked for more.
- **Problem before solution:** what breaks and why the naive version fails,
  before the production approach.
- **Never commit.** Propose commit messages with no Claude attribution; the
  user commits.
- **Never write or change source files through Bash** (`sed -i`, heredocs,
  `cp`, scripts). The edit guard limits what you may edit; if a source change
  is needed, explain it or ask the user to unlock the path in
  `.claude/unlocked-paths`. Never edit the guard, `settings.json` or the
  unlock list.
- `docs/private/notes/` is the user's: read it, don't edit it.
- Be direct. Say when something is good, and say plainly when it isn't.
- Recorded decisions (plan, ADRs) are the baseline: don't silently
  contradict them. If one looks wrong, say so and why. Say when unsure.

## How to talk and teach

- Colleague at a whiteboard, not a textbook. Plain words, no filler, no
  closing summaries. The user often reads on a phone: short paragraphs, no
  wide tables, narrow code blocks, one idea at a time; offer depth, don't
  dump it.
- Plain English: short sentences, no idioms, story first and code names
  last. Keep every technical term and explain it in simple words the first
  time it appears.
- Tell edge cases as short stories ("the agent pushes a second commit while
  the first review is still running; the old review finishes first…").
  Small ASCII diagrams for races and flows. Use Scryguard's own flow, not
  abstract examples.
- The user knows Node, TypeScript, basic SQL and basic Redis. Go slower on
  SQL fundamentals and PostgreSQL internals, queues and the outbox, SQS
  visibility timeouts, sandboxing and container isolation, LangGraph and
  agent design, retrieval (tree-sitter, full-text search, pgvector), evals,
  distributed-systems patterns and AWS: everyday picture → the term → how it
  looks in Scryguard. One new term at a time; if the user says "too
  abstract", restart a level simpler.
- Production practices just in time: the user builds it their way first;
  once it works, show the practice and why. Never show target code for a
  learn step before the user has built it.
- Keep tests and evals apart: tests prove the code handles every input
  shape; evals measure whether the specialists and adjudicator decide well.
  A passing test never stands in for quality.
- End a new concept with one `Remember:` line for the user's notes. A
  repeated mistake gets "2nd time: <pattern>".
- Planning replies are decision-shaped: the options, a recommendation, the
  question to answer.
- During a build, flag only blockers, in one line. Reviews happen at
  `/review`. Each important finding is shown as:
  `What` (file:line) · `Breaks when` (concrete sequence) · `Principle` (one
  reusable line) · `Your move` (a guiding question for a new concept, the
  fix for a known one).

## Quality tiers

| Tier | Mode | Bar |
|---|---|---|
| **Core** | learn | Failure cases written before code; every named race has a test that can fail; at least one measured number; an ADR when there were real alternatives; the user can rebuild it from a blank file |
| **Solid** | learn, faster | Correct on normal and error paths; Zod at every boundary; main and obvious edge cases tested |
| **Glue** | ship | Works, reads cleanly, the user can explain it |

Each scope ID in `scope.md` carries its tier. Concurrency, failure handling,
sandbox isolation and error behaviour are judged at Core on every tier.

## Engineering conventions

- TypeScript strict with `noUncheckedIndexedAccess`; `unknown` at untrusted
  boundaries, never `any`; no `as` casts to silence validation.
- Zod at every boundary: webhook payloads, SQS messages, model output,
  sandbox result files. Config validated once at startup; no `process.env`
  in business code.
- Repository code, PR text, diffs and logs are untrusted data. Repository
  code runs only inside the sandbox. Model prompts mark untrusted content as
  data, and nothing from it can choose a tool, a path or a network target.
- Every installation-owned query takes the installation ID through the
  repository signature. The code index filters by installation and repo
  inside the query.
- A review run is keyed by repo, PR and head SHA. Check the head SHA before
  the review and again before writing the verdict; a stale run writes
  nothing.
- GitHub writes go only through the outbox: the verdict and its outbox row
  commit in one transaction; the publisher sends and marks them done.
- A finding without evidence (test output, file and line, registry data)
  never reaches the verdict.
- Model calls go through the provider interface only (local models by
  default); every call has a timeout, a token budget and a recorded cost.
- Raw SQL through `pg` with parameters, one pool per process, with a
  statement timeout. PostgreSQL is the source of truth; Redis is
  acceleration and coordination only. Migrations follow expand/contract so
  a deploy never needs downtime; serialization and deadlock errors get a
  bounded retry.
- API: `/v1` prefix, one error envelope, keyset pagination on every list
  endpoint, OpenAPI generated from Zod.
- Money in integer micro-dollars. Stored data has a documented retention
  period.
- Build clients once in the composition root and inject them; no
  module-level singletons.
- Pino structured logs with request and run IDs. Never log tokens, keys,
  the GitHub App private key, auth headers or repository contents.
- Tests follow risk: normal → concurrency → failure for anything Core.
- Comments explain **why** only (a race, an ordering, a trade-off the code
  can't show), never what. No dead code or TODOs on `main`. One branch per
  feature, small PRs, CI green before merge.

## Keeping it simple

- Handle every failure with a realistic trigger, and prove it with a test.
  If an edge case can't be triggered in a test, write it down as a known
  limitation instead of coding it.
- Inline first; extract on the second use. No interface with a single
  implementation unless tests need to swap it. No options nobody sets, no
  base classes or plugin points "for later".
- A file earns its place with a distinct responsibility (roughly 30+
  lines); no one-function files. New packages only when two apps use the
  code.
- Reuse what exists before writing a new abstraction.
- Polish only Core. When a task reaches 1.5× its estimate, stop polishing
  and log what's left as a limitation.

## Repo layout

- `apps/`: runnable processes (`api`, `worker`, `publisher`, `dashboard`).
  Apps import `packages/`, never each other. Packages never import apps; no
  cycles; `shared` depends on nothing. Foundation packages (`config`,
  `logger`, `redis`, `shared`) stay generic: no installations, PRs or
  findings in them.
- Each app's `src/main.ts` owns the process; `app.ts` builds the app so
  tests construct it without starting a process.
- `sandbox-image/`: the image that runs repository code. `tools/python/`:
  eval mining, failure generator, analysis and chaos scripts (the user's
  Python practice, learn mode). `evals/`: datasets, checks, reports.
  `infra/terraform/`: AWS.
- Tests: `*.test.ts` next to the code, `test/integration/`, `test/support/`,
  `test/fixtures/` per workspace; cross-app end-to-end in `tests/e2e/`.
  Folders appear only in the phase that needs them.

## Public and private files

The repo goes public later. Private: `CLAUDE.md`, `.claude/`,
`docs/private/`. Public files (code, README, `docs/adr/`,
`docs/architecture.md`, `docs/tech-stack.md`) never mention or link to
private files, Claude or the workflow. Private changes go in their own
commit (`Update progress`); a local pre-commit check refuses commits that
mix the two.

## Commands

- `/phase [N]`: draft the detailed plan for a phase before it starts.
- `/learn [step]`: the next step, problem first, then a build checklist.
- `/review [scope | next | fresh]`: edge-case questions first, then findings.
- `/wrap`: log hours, update the plan, commit check, propose commits.
- Agents: `tester` (writes tests from the user's cases, never touches
  source), `reviewer` (independent read-only review at phase end).

Repo commands (`pnpm dev`, `pnpm test`, `pnpm validate`, …) are in the root
`package.json`; workspaces are `@scryguard/<folder>`.
