# Scryguard plan

## Now

Current phase: 0 · Foundation (in progress)
Status: on track · cuts: C1 (swapped for API keys) · 8 / 10 h · Hosted $0 / $10
Done: stack, CI, all five packages; api middleware, config (3 apps),
`app.ts`, health + readiness, OpenAPI; P0.2 gitleaks test; ADR 0009
drafted (Proposed). 430 unit + 25 integration green.
Next: theory (T 2: event loop, signals, drill-0), then P0.7 shutdown
coordinator from a blank file → `main.ts` ×3, P0.4 shells + smoke,
P0.8, P0.9 ([phases/phase-0.md](phases/phase-0.md)).
Risk: ~6 h left (T 2, B ~4) → ~14 h total, under the 15 h 1.5× line.
Open questions: accept ADR 0009 (keep the OpenAPI line?).

## Phases

Starts 2026-11-01. T = theory (phase topics + fundamentals, sized at ~1.4×
for notes), B = build + rework. Project hours come from the 9-month plan:
~35 by Nov 26, ~135 in the winter break, ~109 in Jan–Feb, ~64 in Mar–Apr,
~119 May 1–Jun 15, ~43 Jun 15–mid-July. Calendar: Sem 3 exams Nov 20–26,
winter break Nov 27–Dec 31, Sem 4 mid-sems in March, end-sems mid to late
April, summer May 1–mid-July (15-day trip inside it).

| # | Phase | T | B | Plan | Cum | Deadline | T act | B act | Status |
|---|---|---:|---:|---:|---:|---|---:|---:|---|
| 0 | Foundation | 2 | 8 | 10 | 10 | Nov 5 | 0 | 8 | in progress |
| 1 | Vertical slice | 6 | 24 | 30 | 40 | Dec 2 | | | |
| 2 | Control plane | 14 | 48 | 62 | 102 | Dec 14 | | | |
| 3 | Reliable processing | 12 | 48 | 60 | 162 | Dec 29 | | | |
| R1 | Review 1 | 3 | 3 | 6 | 168 | Dec 31 | | | |
| 4 | Sandbox | 10 | 45 | 55 | 223 | Jan 31 | | | |
| 5 | Agents v1 | 8 | 41 | 49 | 272 | Feb 28 | | | |
| 6 | Code intelligence | 10 | 40 | 50 | 322 | Apr 10 | | | |
| R2 | Review 2 | 3 | 3 | 6 | 328 | Apr 30 | | | |
| 7 | Agents v2 | 6 | 24 | 30 | 358 | May 15 | | | |
| 8 | Evals | 6 | 34 | 40 | 398 | Jun 1 | | | |
| 9 | Dashboard + live updates | 2 | 11 | 13 | 411 | Jun 8 | | | |
| 10 | AWS | 14 | 36 | 50 | 461 | Jun 15 | | | |
| 11 | Hardening + ship | 4 | 32 | 36 | 497 | Jul 8 | | | |
| R3 | Review 3 + wrap | 3 | 3 | 6 | 503 | Jul 14 | | | |
| | **Total** | **103** | **400** | **503** | | | | | |

Project hours available: ~170 by Dec 31, ~279 by Feb 28, ~343 by Apr 30,
~462 by Jun 15, ~505 by mid-July. Slack at each checkpoint: ~2, ~7, ~15,
~1, ~2 h. Every checkpoint is tight; C2 is the first cut if any of them
runs behind, and the 9-month plan's 38 h buffer backs the final weeks.

Design intent, decisions and per-phase notes from the planning
discussion: [design-notes.md](design-notes.md). `/phase` reads it.

v1 (phase 5): a real trust gate that catches weakened tests and suppressed
checks on live PRs, running locally. It is the resume-safe version if
anything later slips.

## Phase goals

| # | Goal | Done when |
|---|---|---|
| 0 | Repo, workspaces, foundation packages, CI, local stack | `pnpm validate` green locally and in CI; Docker Compose stack up |
| 1 | Thinnest path: GitHub App, verified webhook, diff, one local-model call, Check Run | A PR on the test repo gets a Check Run within a minute |
| 2 | Data model and API: installations, PRs, runs, idempotent intake, keyset lists, GitHub login, roles, API keys, rate limits, caching | Duplicate deliveries make one run; installation A never sees B's data; a revoked key stops working; list query uses an index (`EXPLAIN ANALYZE` on 100k rows) |
| 3 | SQS + DLQ, idempotent consumer, visibility heartbeats, stale-SHA checks, outbox + publisher | 0 duplicate or stale results across 200 reviews with random worker kills |
| 4 | Docker sandbox: base vs head test runs, `tsc`, Semgrep, limits, results via RustFS (S3 locally) | Malicious-repo suite fully contained; base-vs-head shows a deleted test |
| 5 | LangGraph graph: rule-based router, test-integrity and guardrail-bypass specialists, basic adjudicator, step journal | v1 catches seeded test weakening and suppressed checks with evidence |
| 6 | tree-sitter symbol table and chunks, pgvector + full-text, rank fusion, per-commit index | Right function in the top 5 for a 20-pair test set |
| 7 | Hallucination + dependency and intent + completeness specialists, full adjudicator, injection defenses | All four specialists run; injection fixture contained |
| 8 | Python dataset mining and failure generator, promptfoo suites, ablation, local vs hosted run | Detection rate, precision, cost per review and the ablation written up |
| 9 | SSE timeline via Redis pub/sub, AI-written dashboard pages | Live timeline updates during a review |
| 10 | Terraform: VPC + endpoints, RDS, SQS, S3, ECR, Fargate sandbox, EC2 + Caddy, SSM, OIDC deploys, alarms, link to the model server | `terraform apply` from nothing → a PR is reviewed on AWS; `destroy` is clean |
| 11 | Security review, k6, failure drills, metrics and dashboards, SLOs with burn-rate alarms, restore drill, runbooks, demo repository, README, demo video | Headline numbers measured and written up; every drill has a written result; every alarm has a runbook |

## Theory per phase

Phase topics, then fundamentals (F) read just before the phase. `/phase`
turns each into specific resources with hours.

| # | T | Topics |
|---|---:|---|
| 0 | 2 | Reading the reused foundation · F: event loop, signals, graceful shutdown |
| 1 | 6 | GitHub Apps (app JWT, installation tokens, permissions), webhook HMAC over the raw body, Checks API, Docker basics, Ollama and the OpenAI-compatible API |
| 2 | 14 | PostgreSQL: MVCC, isolation levels, locks, B-tree indexes, `EXPLAIN`, keyset pagination (9) · idempotency and deduplication · Redis Lua and rate-limit algorithms · API-key security (hashing, prefixes, shown once, constant-time compare) · cache-aside and invalidation · F: OAuth 2.0/OIDC, sessions vs JWT, hashing vs encryption, authn vs authz, BOLA |
| 3 | 12 | SQS: at-least-once, visibility timeout, long polling, DLQ and redrive (4) · idempotent consumers, outbox, state machines, leases and heartbeats (5) · F: queue vs stream (Kafka partitions and consumer groups), consistency models, CAP/PACELC |
| 4 | 10 | Namespaces and cgroups, container security (capabilities, seccomp, no-new-privileges, read-only root, non-root), Docker Engine API (6) · object storage · Semgrep rules · test runner JSON output |
| 5 | 8 | LangGraph.js (state, nodes, parallel branches), agent loops and stop conditions, tool calling and structured output with local models (6) · prompt injection · F: tokens, context windows, sampling |
| 6 | 10 | tree-sitter queries, chunking code, embeddings and similarity, HNSW parameters, Postgres full-text search, rank fusion, retrieval metrics (8) · F: replication and read replicas, sharding, consistent hashing |
| 7 | 6 | npm registry metadata, dependency confusion and slopsquatting, indirect prompt injection, LLM-as-judge pitfalls |
| 8 | 6 | Eval design, held-out splits, variance and repeated runs, precision and recall, ablation, cost accounting |
| 9 | 2 | SSE framing and backpressure, Redis pub/sub · F: SSE vs WebSockets |
| 10 | 14 | Terraform state and locking, IAM evaluation, VPC and endpoints, ECS RunTask on Fargate, RDS, SSM, GitHub OIDC, CloudWatch (11) · F: L4 vs L7 load balancing, CDNs, Multi-AZ and RPO/RTO |
| 11 | 4 | Load testing and percentiles, failure drills, security review checklist, RED metrics, SLIs and SLOs, error budgets and burn-rate alerts, backups and RPO/RTO · F: unique ID generation, feed fan-out |
| R | 3 each | Study pack for the phases since the last review |

## Rules

- **Checkpoints.** End of phase 1: actual ÷ planned > 1.10 → the next cut
  is applied. Dec 31, Feb 28, Apr 30 and Jun 15: more than 10% behind the
  Cum column → the next cut is applied.
- **v1 by Feb 28 is fixed.** If phases 4–5 slip, cut inside later phases,
  never v1.
- **Cut order:** C2 → C3 → C4 → C5 (C1 already applied; see Cuts). Cuts
  remove whole items only.
- **Never cut** crash safety (idempotent consumer, stale-SHA checks,
  outbox), sandbox isolation, installation isolation, the evidence rule,
  tests on Core work, or theory hours.
- **Plan freeze.** New features only through an equal-hours swap, logged
  in scope.md's change log with the reason.
- **Models.** Local by default. Hosted spend cap: $10, used only for the
  phase 8 comparison. Above it, the next run needs the user's go-ahead.
- **Stretch** items start only when the phase before them finished early,
  and they use slack, never buffer that a later checkpoint needs.
- **1.5× rule.** A task at 1.5× its estimate stops being polished; what's
  left is logged as a limitation.
- **Dependabot PRs** are maintenance: once a week, merge the grouped
  minor/patch PR when CI is green; read the changelog before a major; close
  a red one unless it's a security fix. Time is logged as rework.

## Cuts and stretch

| ID | Cut (in order) | Saves |
|---|---|---:|
| C1 | Agent stats dashboard page (applied 2026-10-31, swapped for API keys) | 3 |
| C2 | Hosted-model comparison run | 6 |
| C3 | Grafana dashboards → CloudWatch only | 3 |
| C4 | Eval set 25 → 15 cases | 4 |
| C5 | Per-commit incremental index → full re-index per review | 8 |

| ID | Stretch (only if ahead; order below) | Cost |
|---|---|---:|
| S1 | Claim-verifier tester (writes a test for the PR's claim, runs base vs head) | 15–20 |
| S2 | Package-risk check as a Python Lambda | 8–10 |
| S3 | OpenTelemetry tracing across API → SQS → worker | 6 |
| S4 | LLM-based router | 5 |
| S5 | Behaviour-diff specialist | 15 |
| S6 | Resilience: circuit breaker on the model server, one review deadline passed to every call | 3 |
| S7 | Audit log of sensitive actions | 2 |
| S8 | Kill switches (specialist, model calls, installation) | 2 |

Stretch order: S6 → S7 → S1 → S3 → S2 → S8 → S4 → S5.

## Scope

Full scope, specs and done-when: [scope.md](scope.md) (to be written). IDs
per phase:

| Phase | IDs |
|---|---|
| 0 Foundation | F0.x |
| 1 Vertical slice | V1.x |
| 2 Control plane | P2.x |
| 3 Reliable processing | Q3.x |
| 4 Sandbox | X4.x |
| 5 Agents v1 | A5.x |
| 6 Code intelligence | I6.x |
| 7 Agents v2 | A7.x |
| 8 Evals | E8.x |
| 9 Dashboard + live updates | D9.x |
| 10 AWS | W10.x |
| 11 Hardening + ship | H11.x |

## Deferred

- `scope.md` with every ID, spec, tier and done-when → before phase 0.
- ADRs 0001–0007 linked from `docs/tech-stack.md` → before phase 0.
- `docs/architecture.md` written 2026-10-31 as the target design → revise
  at the end of phases 3, 5 and 10 against what was actually built (H11.6
  is the final pass).
- README written 2026-10-31 with a public roadmap. At each phase end,
  `/wrap` ticks the roadmap box and adds what the phase made true (badge
  and Getting started after 0, configuration after 2, crash-test result
  after 3, screenshot, example finding, project structure and limitations
  after 5, results and method after 8, deployment and cost after 10, demo
  after 9–11, security note, license, author links and repo topics at
  release). The full list is in the `/wrap` skill.
- `.gitignore`, `.gitleaks.toml`, env examples → phase 0.
- Private link from AWS to the model server (e.g. Tailscale) → phase 10.
- `tools/python/` and `evals/` folders → phase 8 (dataset mining can start
  earlier as Python practice).
- Commit split check: `.claude/scripts/commit-split.sh`, run by the local,
  never-committed `.git/local-pre-commit`. After cloning anywhere else,
  recreate that file (`exec .claude/scripts/commit-split.sh`) and make it
  executable. When simple-git-hooks is added, keep its call to
  `.git/local-pre-commit`.
- **Going public** (around phase 11). Never switch this repo to public: its
  history holds every private file. Instead:
  1. Keep this repo private as the full record.
  2. Fresh clone into a new folder; install `git-filter-repo`.
  3. `git filter-repo --invert-paths --path .claude --path CLAUDE.md --path
     docs/private`.
  4. Check: `git log --stat` shows no private path; `grep -rniE
     "claude|docs/private|/learn|/wrap"` finds nothing private; commit
     messages read well in public; a full-history `gitleaks git . --config
     .gitleaks.toml --redact` finds nothing.
  5. Add a LICENSE, then push to a **new** public GitHub repo.
  6. To update it later, repeat steps 2–5 from a fresh clone.

## Review

Open important findings from `/review` (removed when fixed).

## Log

`date · T h · B h · what got done · Hosted $`

- 2026-10-31 · setup · repo created; `docs/tech-stack.md`; Claude setup
  (CLAUDE.md, hooks, guard, commit check, reviewer and tester agents,
  `/phase`, `/learn`, `/review`, `/wrap`)
- 2026-10-31 · decision · local models via Ollama instead of a hosted
  provider (cost); hosted models only for one comparison run, capped at $10
- 2026-10-31 · decision · plan written: 12 phases + 3 reviews, 483 h (T 102
  · B 381) against ~505 h available; v1 fixed at Feb 28
- 2026-10-31 · decision · `scope.md` written; coverage check against the
  essential interview concepts added P2.10, A5.9, A5.10 and extended D9.1
  (+8 h → 491 h); API keys left undecided; `design-notes.md` records the
  planning context for `/phase`
- 2026-10-31 · decision · Scryguard replaces LLMux as the project for this
  period; LLMux stops; its phase 0 foundation is reused for F0.1
- 2026-10-31 · decision · API keys added as P2.11 (+4 h), swapped for C1
  (agent stats page, −3 h); plan 491 → 492 h; LLMux marked stopped in its
  own plan
- 2026-10-31 · decision · scope compared with LLMux and reviewed for
  portfolio value: phase 11 gains metrics and dashboards, SLOs, a restore
  drill, runbooks and a public demo repository (+11 h → 503 h); stretch
  S6–S8 added; details added to several IDs without hours (scope change
  log)
- 2026-11-02 · T 0 · B 6 · Oct 31–Nov 2: root and workspace config, local
  stack (RustFS for MinIO), CI; packages shared, logger, config, database,
  redis with unit and integration tests; F0.5 redaction and error kinds
  narrowed to phase 0 (logger redaction handed over); notes ×2 · Hosted $0
- 2026-11-02 · T 0 · B 2 · api middleware (user) with 76 tests; per-app
  config, `app.ts`, health + readiness, OpenAPI generation (shipped);
  P0.2 gitleaks rule test via pinned Docker image; ADR 0009 drafted ·
  Hosted $0
