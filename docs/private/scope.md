# Scope

This document defines **what** Scryguard builds, with an identifier for
every feature. Scryguard is a trust gate for pull requests written by AI
coding agents: it detects the characteristic ways those agents fail and
backs every finding with evidence before a human relies on the change.
**When** each feature is built, the hour budget and the governing rules are
in [plan.md](plan.md); each phase's detailed plan is in `phases/phase-N.md`.

How to use this document:

- A phase builds only its own IDs. Work that maps to no ID is a new feature
  and requires a swap under §9.
- "Done when" states the minimum for an ID to count as built. The phase
  plan expands it into tests, named races and failure experiments.
- Details within an ID (column names, limits, endpoint shapes, error codes)
  are decided during the phase and recorded in an ADR or the phase plan.
  Settling such details is not scope growth; adding a capability is.
- Tiers (Core / Solid / Glue) are defined in `CLAUDE.md`.

## Goals: what Scryguard must demonstrate

Scryguard is a learning and portfolio project aimed at backend, AI
engineering and AI infrastructure roles. Each feature exists to demonstrate
one of the capabilities below; depth takes priority over breadth.

**Backend engineering**
- A GitHub App integration with verified webhooks, idempotent intake and
  correct handling of installation tokens (V1, P2).
- Authentication and authorisation done properly: OAuth login, server-side
  sessions, role-based access and strict isolation between installations
  (P2).
- Schema design, constraints, indexed keyset pagination and atomic rate
  limiting (P2).

**Distributed systems**
- At-least-once processing on SQS with an idempotent consumer, visibility
  heartbeats, attempt-based fencing and rejection of superseded work (Q3).
- A transactional outbox that publishes every verdict to GitHub exactly
  once, through worker crashes and redelivery (Q3).

**Security**
- Untrusted repository code executed only in an isolated sandbox with no
  credentials, no permissions and no network access, locally and on AWS
  Fargate (X4, W10).
- Containment of prompt injection carried in code, PR text and tool output
  (A5, A7).

**Generative AI**
- A multi-agent graph in which a router, four evidence-based specialists
  and an adjudicator cooperate, running on local models with validated
  structured output (A5, A7).
- Hybrid code retrieval combining a symbol table, full-text search and
  vector search (I6).

**Evaluation**
- Measured detection rate and precision against a generic-reviewer
  baseline, with variance across repeated runs, an ablation per specialist
  and a cost comparison between local and hosted models (E8).

**Cloud**
- A reproducible Terraform deployment with least-privilege IAM, private
  networking for the sandbox and keyless CI deploys (W10).

### Headline results

1. Zero lost, duplicated or stale verdicts across 200 reviews with injected
   worker and publisher crashes (Q3, H11).
2. Detection rate and precision on seeded agent failure modes, compared
   with a generic single-prompt reviewer (E8).
3. A malicious-repository suite fully contained, locally and on Fargate
   (X4, W10).

## 1. Users and main flows

**Users.** Maintainers of TypeScript and JavaScript repositories on GitHub
who accept pull requests from AI coding agents.

**Flows.**

1. A maintainer installs the GitHub App on selected repositories and
   configures how agent-authored pull requests are recognised.
2. An agent opens or updates a pull request. Scryguard reviews the head
   commit and publishes a trust report as a Check Run: what was verified,
   what failed, and what needs human attention.
3. Members of the installation sign in to the dashboard to read trust
   reports, follow a review live and see evaluation results, according to
   their role.
4. Scripts and CI jobs read review results through the API with an
   installation-scoped API key.

## 2. Features by phase

### F0 Foundation

| ID | Feature | Tier |
|---|---|---|
| F0.1 | Monorepo `@scryguard/*`: root tooling and the foundation packages (`config`, `database`, `logger`, `redis`, `shared`) reused from LLMux and renamed | Glue |
| F0.2 | Configuration validated once at startup with Zod; the process refuses to start on invalid configuration | Glue |
| F0.3 | One PostgreSQL pool per process; plain SQL migrations with `node-pg-migrate` | Glue |
| F0.4 | Redis client with fail-fast settings, injected from the composition root | Glue |
| F0.5 | Structured logging with request and run IDs; generic redaction of the secrets phase 0 holds (passwords, connection URLs, auth and cookie headers, bodies). GitHub secrets and repository contents are redacted in phase 1, with the code that first holds them (V1.2, V1.3, V1.4) | Solid |
| F0.6 | Liveness and readiness endpoints; graceful shutdown (stop accepting, drain, close pools) | Core |
| F0.7 | One error envelope with stable codes; internal details never reach clients | Solid |
| F0.8 | CI (lint, typecheck, tests, build, OpenAPI breaking-change check); gitleaks with rules for GitHub tokens and private keys; Dependabot; pre-commit hooks (lint-staged, plus the local commit-split check) | Glue |
| F0.9 | Docker Compose for PostgreSQL 18 with pgvector, Redis, ElasticMQ and RustFS (S3-compatible), plus Toxiproxy in front of PostgreSQL and Redis for failure tests (kept from the reused foundation); Ollama reachable from the stack | Glue |
| F0.10 | HTTP edges: request IDs, a body-size limit applied before parsing, security headers | Solid |
| F0.11 | Shared lifecycle: shutdown coordinator, process handlers and entry point; composition root; `worker` and `publisher` process shells | Core |

Done when: a clean clone is green locally and in CI; a search for the
previous project's names outside `docs/private/` and `.claude/` finds
nothing; every reused module can be explained without notes. If the
foundation is reused from LLMux (decided 2026-10-31).

### V1 Vertical slice

| ID | Feature | Tier |
|---|---|---|
| V1.1 | GitHub App registered on a test organisation with least-privilege permissions (checks: write; contents, pull requests, issues and metadata: read; issues are needed for linked-issue context in A7.2); private key stored outside the repository | Solid |
| V1.2 | Webhook endpoint that verifies the HMAC-SHA256 signature over the raw body before parsing, rejects failures with 401 and acknowledges quickly | Core |
| V1.3 | Installation token client: app JWT exchanged for an installation token, reused until shortly before expiry | Solid |
| V1.4 | Pull request diff fetched and summarised by one local-model call through the provider interface, with validated structured output | Glue |
| V1.5 | Check Run created as in progress and completed with a conclusion and summary | Solid |
| V1.6 | Local model selected for 8 GB of VRAM after verifying tool calling and JSON-schema output on a fixed prompt set; the choice and its measurements are recorded | Solid |
| V1.7 | Test fakes: a fake model server (slow, timeout, malformed JSON, wrong schema, refusal) and a fake GitHub API (401, 404, 422, rate-limited, slow), so no test calls a real service | Glue |

Done when: a pull request on the test repository receives a completed Check
Run within about a minute; a tampered webhook is rejected and creates
nothing; one delivery can be traced end to end through the logs.

### P2 Control plane

| ID | Feature | Tier |
|---|---|---|
| P2.1 | Schema: installations, repositories, pull requests, review runs, webhook deliveries, users and memberships, with foreign keys, unique and check constraints, and indexes for the actual queries | Core |
| P2.2 | Installation lifecycle events (installed, uninstalled, repositories added or removed); uninstalling disables the installation and schedules deletion of its data; retention periods for stored data (runs, findings, snapshots, logs) are documented and enforced | Solid |
| P2.3 | Idempotent intake: a delivery ID is processed once; a review run is unique per repository, pull request and head SHA | Core |
| P2.4 | Recognition of agent-authored pull requests by author account, label or commit trailer, configurable per repository; other pull requests are skipped by default | Solid |
| P2.5 | Dashboard sign-in with GitHub OAuth; server-side sessions in PostgreSQL with secure cookie attributes, rotation at sign-in and expiry | Core |
| P2.6 | Roles (owner, member, viewer) enforced with CASL; every installation-owned query takes the installation ID; another installation's resources return 404 | Core |
| P2.7 | Read API: review run list with keyset pagination (default and maximum limit, deterministic tie-breaker) and run detail | Solid |
| P2.8 | Rate limits as a Redis token bucket implemented in Lua, per installation for intake and per user or API key for the API; `RateLimit-*` headers and 429 with `Retry-After`; behaviour when Redis is unavailable recorded in an ADR | Core |
| P2.9 | OpenAPI document generated from the Zod schemas | Glue |
| P2.10 | Cache-aside in Redis for GitHub API reads and installation tokens, with TTLs, explicit invalidation and a measured hit rate | Solid |
| P2.11 | API keys for programmatic read access, scoped to an installation: random, prefixed keys stored as hashes, shown once, revocable, checked in constant time | Core |

Done when: the same delivery processed in parallel creates exactly one run;
isolation tests prove installation A can never read installation B's data;
`EXPLAIN ANALYZE` on 100,000 runs shows the list query using its index; an
expired or revoked session is rejected; Redis unavailability produces the
documented behaviour; a revoked API key stops working immediately, and a
key from installation A cannot read installation B's data.

### Q3 Reliable processing

| ID | Feature | Tier |
|---|---|---|
| Q3.1 | SQS standard queue with a dead-letter queue (ElasticMQ locally); every queued run is guaranteed a message, with the mechanism (outbox or sweeper) decided in the phase | Core |
| Q3.2 | Worker with long polling, bounded concurrency and validated messages | Solid |
| Q3.3 | Idempotent consumer: a run is claimed by a conditional update carrying an attempt number; completed or actively claimed runs are not reprocessed | Core |
| Q3.4 | Visibility heartbeat while a review runs; a worker whose attempt has been superseded stops and every write is checked against the attempt number | Core |
| Q3.5 | Stale-work rejection: the head SHA is checked before the review starts and again before the verdict is written; a superseded run is marked stale and publishes nothing | Core |
| Q3.6 | Run state machine with all permitted transitions defined in one place and guarded in SQL | Core |
| Q3.7 | Transactional outbox: the verdict and its outbox row commit together; the `publisher` sends Check Run updates with retries and backoff, and never publishes a run twice | Core |
| Q3.8 | Poison messages moved to the DLQ after a fixed number of receives; the run is marked failed and a metric is emitted | Solid |
| Q3.9 | Graceful drain on SIGTERM: stop receiving, then finish or release in-flight runs before the deadline | Solid |
| Q3.10 | Chaos script and invariant checker | Core |

Done when: 200 reviews with random `kill -9` of workers and the publisher
end with no lost run, no duplicate GitHub post and no stale verdict, and
GitHub's status matches the database for every run; a redelivered message,
a frozen worker (`SIGSTOP`) and a head SHA changing mid-review are each
covered by a test.

### X4 Sandbox

| ID | Feature | Tier |
|---|---|---|
| X4.1 | Sandbox runner interface with a Docker implementation using the Engine API | Solid |
| X4.2 | Resource and privilege limits: CPU, memory, process count, wall-clock timeout and output size; non-root user, all capabilities dropped, `no-new-privileges`, read-only root filesystem with a writable work directory | Core |
| X4.3 | Dependencies installed in a separate throwaway container with lifecycle scripts disabled; the test, type-check and analysis steps run with no network | Core |
| X4.4 | No credentials enter the sandbox: the repository is fetched outside it with the installation token and only source files are passed in | Core |
| X4.5 | Base-versus-head execution: tests and `tsc --noEmit` on both commits, with results read from the test runner's JSON report | Core |
| X4.6 | Semgrep in the sandbox image, with security rules and project rules for `@ts-ignore`, `eslint-disable`, empty `catch` blocks and `any` casts | Solid |
| X4.7 | Snapshot in and results out through object storage (RustFS locally); results validated, and a missing or truncated result is recorded as inconclusive | Solid |
| X4.8 | Containers removed on every path, plus a reaper for orphans left by crashes | Solid |
| X4.9 | Malicious-repository suite: environment dump, outbound network call, fork bomb, memory exhaustion, writes outside the work directory, host file reads, output flood | Core |

Done when: every case in the malicious-repository suite produces its
expected contained outcome; base-versus-head execution detects a deleted
test and a newly skipped test on fixtures; no container survives a worker
crash once the reaper has run. Packages that require install scripts are a
documented limitation and yield an inconclusive result, never a pass.

### A5 Agents v1

| ID | Feature | Tier |
|---|---|---|
| A5.1 | LangGraph.js graph (router → specialists in parallel → adjudicator) with typed, validated state | Solid |
| A5.2 | Rule-based router that classifies the diff (tests, configuration or CI, dependencies, source) and selects specialists with per-specialist token and time budgets | Solid |
| A5.3 | Provider interface for local models served by Ollama (OpenAI-compatible): timeout, one retry on invalid output, errors classified as retryable or permanent, tokens and duration recorded, cost computed in integer micro-dollars from a price table (zero for local models) | Solid |
| A5.4 | Test-integrity specialist: deleted, skipped or weakened tests, loosened assertions, snapshots updated without a code change, mocks of the unit under test | Core |
| A5.5 | Guardrail-bypass specialist: suppressed type and lint checks, `any` casts, empty `catch` blocks, removed CI steps, lowered coverage thresholds, relaxed compiler strictness | Core |
| A5.6 | Adjudicator v1: discards findings without evidence, merges duplicates, assigns severity and sets the verdict (pass, needs review, block) | Core |
| A5.7 | Agent-step journal: every node records an input summary, tokens, duration and outcome | Solid |
| A5.8 | Untrusted content handling: repository and pull request text is passed as delimited data and cannot select tools, paths or network targets | Core |
| A5.9 | Model response cache keyed by model, prompt version and input hash, bypassed during evaluation runs | Solid |
| A5.10 | Versioned prompts stored in the repository; the prompt version is recorded on every agent step | Solid |

Done when: on seeded fixtures both specialists detect their failure types
with evidence; a test proves a finding without evidence never reaches the
verdict; an unavailable model server yields an inconclusive run, never a
pass. This is **v1**.

### I6 Code intelligence

| ID | Feature | Tier |
|---|---|---|
| I6.1 | tree-sitter parsing of TypeScript and TSX into a symbol table (definitions, exports, imports) and function-level chunks with path and line range; a fallback for files that do not parse | Solid |
| I6.2 | Chunk storage per installation, repository and commit, with a vector (HNSW) and a `tsvector` (GIN) | Solid |
| I6.3 | Embedding provider interface for a local embedding model, with batching, retries and recorded duration | Solid |
| I6.4 | Indexing as a queue job: a full index on installation and an incremental index on push (changed files only, skipped by content hash) | Core |
| I6.5 | Hybrid search with reciprocal rank fusion, filtered by installation and repository inside the query | Core |
| I6.6 | Call-site lookup for functions whose signatures changed | Solid |
| I6.7 | Retrieval check on 20 pairs of change and relevant code, with recall@5 and MRR recorded | Solid |

Done when: the index stays correct after a file is edited, renamed and
deleted; of two quick pushes the newer commit wins; an isolation test shows
no result ever crosses installations; recall@5 is measured and recorded.

### A7 Agents v2

| ID | Feature | Tier |
|---|---|---|
| A7.1 | Hallucination and dependency specialist: unknown functions, types and imports (symbol table and `tsc`); new packages checked against the npm registry for existence, age, downloads and install scripts; lockfile anomalies | Core |
| A7.2 | Intent and completeness specialist: pull request description and linked issue compared with the diff; unrelated edits; changed signatures whose callers were not updated | Solid |
| A7.3 | Adjudicator v2: evidence across specialists, severity rules and the structure of the trust report | Core |
| A7.4 | Prompt-injection fixtures with instructions hidden in code comments, pull request text and test output | Core |
| A7.5 | Trust report rendered in the Check Run summary | Solid |

Done when: all four specialists run on the fixture set; no injection
fixture causes unintended tool use or changes a verdict; the trust report
renders correctly on GitHub.

### E8 Evaluations

| ID | Feature | Tier |
|---|---|---|
| E8.1 | Dataset mining in Python: public agent-authored pull requests with labels (for example, later reverted), with their licences noted | Solid |
| E8.2 | Seeded failure generator in Python: at least 25 cases across the failure types, split into development and held-out sets; prompts are tuned only on the development set | Solid |
| E8.3 | promptfoo suites with a custom provider that calls the real review pipeline, and "caught" checks on file, line range and failure type | Solid |
| E8.4 | Metrics: detection rate per failure type, precision, cost and duration per review, three runs per case; the held-out set is run once, after tuning ends | Core |
| E8.5 | Baseline: a generic single-prompt reviewer on the same cases | Solid |
| E8.6 | Ablation: each specialist removed in turn | Solid |
| E8.7 | Hosted comparison: the same suite on one hosted model within the $10 cap | Glue |
| E8.8 | Report in `evals/reports/` covering results, variance and an analysis of every miss | Solid |

Done when: the report gives detection rate and precision with their
variance, the baseline, the ablation and the cost per review, and explains
each miss.

### D9 Dashboard and live updates

| ID | Feature | Tier |
|---|---|---|
| D9.1 | SSE endpoint for run events, including streamed specialist output, with `Last-Event-ID` resume, heartbeats and disconnect handling | Solid |
| D9.2 | Redis pub/sub fan-out of run events from workers to API instances | Solid |
| D9.3 | Dashboard pages (AI-written): trust report, live run timeline, evaluation results | Glue |
| D9.4 | Agent statistics page (cut under C1 on 2026-10-31, swapped for P2.11) | Glue |

Done when: the timeline updates live during a review, and a reconnecting
client resumes without missing events (test).

### W10 AWS deployment

| ID | Feature | Tier |
|---|---|---|
| W10.1 | Terraform with remote state in S3 and locking, in one flat configuration | Solid |
| W10.2 | VPC with a public subnet for the application host and private subnets for RDS and the sandbox | Solid |
| W10.3 | RDS PostgreSQL with pgvector, single-AZ, automated backups | Solid |
| W10.4 | SQS queue and DLQ; S3 buckets with lifecycle rules | Solid |
| W10.5 | ECR and a Fargate task definition for the sandbox: no task-role permissions, non-root, read-only root; VPC endpoints for ECR, S3 and CloudWatch Logs; no NAT gateway | Core |
| W10.6 | Fargate implementation of the sandbox runner (`RunTask`, completion wait, `StopTask` on timeout) | Core |
| W10.7 | EC2 host running the API, worker, publisher and Redis; Caddy for TLS; a least-privilege instance role | Solid |
| W10.8 | Secrets in SSM Parameter Store | Solid |
| W10.9 | CI deploys through GitHub OIDC: images to ECR, migrations run as a separate step following expand/contract, then restart through SSM Run Command | Solid |
| W10.10 | CloudWatch alarms (DLQ depth, oldest message age, sandbox failures, API 5xx rate) and an AWS Budgets alarm | Glue |
| W10.11 | Private connection from AWS to the model server | Solid |

Done when: `terraform apply` from an empty account yields a public webhook
URL and a reviewed pull request; a probe inside the sandbox task cannot
reach the internet; `terraform destroy` is clean; the monthly cost is
recorded.

### H11 Hardening and release

| ID | Feature | Tier |
|---|---|---|
| H11.1 | Security review against a checklist: webhook verification, OAuth and sessions, authorisation, SQL parameters, secrets, logs, sandbox IAM and network, prompt injection, dependencies | Core |
| H11.2 | k6 load test of webhook bursts, with rate-limit and backpressure behaviour recorded; results kept in `docs/baselines/` | Solid |
| H11.3 | Failure drills with written results: worker containers and sandbox tasks stopped on AWS during reviews, PostgreSQL restart, Redis down, model server down, GitHub returning 5xx; invariants verified | Core |
| H11.4 | Known limitations documented | Glue |
| H11.5 | README with an architecture diagram, the headline results and a demo video | Glue |
| H11.6 | Final `docs/architecture.md` | Glue |
| H11.7 | Prometheus metrics (webhook intake, queue depth and age, review duration and outcome, sandbox failures, model latency and tokens) and Grafana dashboards kept in the repository | Solid |
| H11.8 | Two SLOs with burn-rate alarms: webhook acknowledgement latency and review completion time (p95) | Solid |
| H11.9 | Backup restore drill: RDS restored from a snapshot, with the measured RPO and RTO written down | Solid |
| H11.10 | A runbook per alarm, including DLQ redrive and sandbox failure spikes | Glue |
| H11.11 | Public demo repository with sample agent pull requests and their live trust reports, linked from the README | Glue |

Done when: the headline results are measured and published in the README;
every drill has a written result; every alarm links to a runbook; the demo
repository and the demo video are linked from the README.

## 3. Cut list (C1 applied; next C2 → C5)

Applied in this order when a checkpoint falls more than 10% behind plan.

- **C1 Agent statistics page (3 h).** Removes D9.4. **Applied on
  2026-10-31** as the swap for P2.11 (API keys).
- **C2 Hosted-model comparison (6 h).** Removes E8.7; the report states
  local-model results only.
- **C3 Grafana dashboards (3 h).** H11.7's metrics remain; its Grafana
  dashboards are replaced by CloudWatch views.
- **C4 Smaller evaluation set (4 h).** E8.2 is reduced from 25 to 15
  cases; detection rates are reported with that sample size.
- **C5 Full re-index per review (8 h).** I6.4's incremental indexing is
  replaced by indexing the head commit for each review.

## 4. Stretch (S1 → S8)

Built only when the preceding phase finished early.

- **S1 Claim-verifier tester (15–20 h).** Writes a test for the behaviour
  the pull request claims to fix and runs it against base and head; the
  result becomes evidence for the intent specialist.
- **S2 Package-risk check as a Python Lambda (8–10 h).** Moves A7.1's
  registry checks into a Lambda function.
- **S3 OpenTelemetry tracing (6 h).** One trace per review across the API,
  SQS and the worker.
- **S4 LLM-based router (5 h).** Replaces or supplements A5.2's rules, with
  an evaluation against the rule-based version.
- **S5 Behaviour-diff specialist (15 h).** Generates inputs for changed
  functions and compares base and head outputs in the sandbox.
- **S6 Resilience (3 h).** A circuit breaker on the model server, so runs
  fail fast as inconclusive during an outage, and one review deadline
  passed down to every model call and sandbox check.
- **S7 Audit log (2 h).** Sensitive actions (API keys created or revoked,
  role and settings changes, uninstalls) recorded with actor and time.
- **S8 Kill switches (2 h).** Disable one specialist, pause model calls, or
  pause an installation without a deploy.

Stretch order: S6 → S7 → S1 → S3 → S2 → S8 → S4 → S5. Small, high-value
items come first.

## 5. API surface

Version prefix `/v1` for application endpoints. Shapes are defined in Zod
and published as OpenAPI.

| Endpoint | ID |
|---|---|
| `POST /webhooks/github` | V1.2, P2.2, P2.3 |
| `GET /auth/github/login`, `GET /auth/github/callback`, `POST /auth/logout` | P2.5 |
| `GET /v1/repos`, `PATCH /v1/repos/{id}/settings` | P2.4, P2.6 |
| `POST /v1/api-keys`, `GET /v1/api-keys`, `DELETE /v1/api-keys/{id}` | P2.11 |
| `GET /v1/runs`, `GET /v1/runs/{id}` | P2.7 |
| `GET /v1/runs/{id}/events` (SSE) | D9.1 |
| `GET /v1/eval-reports` | D9.3 |
| `GET /health/live`, `GET /health/ready` | F0.6 |

## 6. Out of scope

Deliberately excluded, with the reason:

- **Automatic fixes.** Scryguard verifies changes; it does not write them.
- **Platforms other than GitHub** and **languages other than TypeScript and
  JavaScript:** breadth without new concepts.
- **Inline review comments:** the summary and Check Run carry the report;
  diff-position mapping adds effort without new concepts.
- **Full review of human-authored pull requests:** outside the product's
  purpose; skipped by default (P2.4).
- **Enforcing merge rules:** maintainers can require the Check Run through
  branch protection; Scryguard does not manage it.
- **An egress allowlist proxy, gVisor or microVMs:** the sandbox has no
  network at all; stronger isolation layers are projects of their own.
- **Model serving work** (vLLM tuning, batching, quantisation studies) and
  **fine-tuning:** deferred to the inference work planned after this
  project.
- **Billing, multi-region, Kubernetes, a Redis cluster:** not needed at this
  scale.

**Studied, not built** (for interviews): Kafka and stream processing,
replication and read replicas, sharding and consistent hashing, CAP and
consistency models, load-balancing algorithms, CDNs, Multi-AZ and disaster
recovery, unique ID generation, feed fan-out, sagas.

## 7. Undecided

| Item | Decision point |
|---|---|
| Local chat and embedding models | Phase 1 (V1.6) and phase 6 (I6.3) |
| Guarantee that every queued run has a message: outbox or sweeper (Q3.1) | Phase 3, recorded in an ADR |
| Behaviour when Redis is unavailable for rate limiting (P2.8) | Phase 2, recorded in an ADR |

## 8. Ideas

Ideas that arise during the build are recorded here in one line. They are
not scope until swapped in under §9.

## 9. Change rule

1. **A new capability requires a swap of equal hours** from the cut list or
   a stretch item, recorded in the change log.
2. **Not a new feature:** fixing a defect, meeting a "done when", a decision
   within an ID (a column, a limit, an error code), or a test the risk
   requires.
3. **A new feature:** a new endpoint, dependency or AWS service, a new
   user-visible behaviour, or a second way to do something an existing ID
   already does. When in doubt, treat it as new and ask.
4. Moving an ID to another phase changes the plan, not the scope.
5. Drift is raised as soon as it is noticed, not at the end of a phase.

## Change log

| Date | Change | Reason |
|---|---|---|
| 2026-10-31 | **Scope recorded.** Twelve phases (F0–H11) with 92 IDs, cut list C1–C5 and stretch S1–S5, matching `plan.md` (483 h) | Initial scope for the trust-gate design |
| 2026-10-31 | Scryguard replaces LLMux; F0.1 reuses LLMux's phase 0 foundation | Single project for the period; saves ~20 h in phase 0 |
| 2026-10-31 | P2.10 (cache-aside), A5.9 (model response cache) and A5.10 (versioned prompts) added; D9.1 extended to stream specialist output. 95 IDs; plan 483 → 491 h | Closes gaps against the essential interview concepts recorded in `design-notes.md` §3; recorded on day 0, before any phase started |
| 2026-10-31 | P2.11 API keys added (+4 h); C1 applied, removing D9.4 (−3 h). 96 IDs listed, one of them cut. Plan 491 → 492 h | Swap under §9.1; closes the last gap in the interview coverage contract |
| 2026-10-31 | F0.9 adds Toxiproxy (in the reused foundation's tests already) | Keeps the copied failure tests working; no hours added |
| 2026-10-31 | Full comparison with LLMux's scope and a portfolio review. Added H11.7 metrics and dashboards, H11.8 SLOs with burn-rate alarms, H11.9 restore drill (RPO/RTO), H11.10 runbooks, H11.11 public demo repository (+11 h, all in phase 11, which falls after the Jun 15 checkpoint); V1.7 test fakes (previously implicit in phase 1). Details added without hours: `RateLimit-*` headers (P2.8), retention policy (P2.2), error classification and micro-dollar cost (A5.3), dev / held-out split (E8.2, E8.4), migrations in deploys (W10.9), baselines folder and failure-drill list (H11.2, H11.3). New stretch S6 resilience, S7 audit log, S8 kill switches. Plan 492 → 503 h | Covers SLOs, disaster recovery and operations, which no project covered; the demo repository lets reviewers see Scryguard working |
| 2026-10-31 | F0 checked against LLMux's foundation list (B0.1–B0.12): F0.10 HTTP edges and F0.11 shared lifecycle added; F0.8 adds the OpenAPI breaking-change check and pre-commit hooks. 98 IDs listed | All arrive with the copy; phase 0 stays at 10 h |
| 2026-10-31 | Pre-start review: V1.1 adds issues: read (needed by A7.2); P2.8 also limits per API key; flow 4 (API keys) added; dependency install location aligned with ADR 0005 | Consistency fixes found in the final review; no hours added |
| 2026-10-31 | Local models served by Ollama replace a hosted provider; hosted models are limited to the E8.7 comparison under a $10 cap | Cost |
| 2026-10-31 | X4.3: dependencies are installed with lifecycle scripts disabled, and the analysis steps run with no network | Keeps the sandbox without network access on AWS (no NAT gateway) while still installing dependencies |
| 2026-10-31 | F0.9, X4.7: RustFS replaces MinIO as the local S3-compatible store. No hours change | MinIO's repository is archived (last release October 2025); RustFS is Apache-2.0, maintained, and set up like MinIO. SeaweedFS is the fallback |
| 2026-11-01 | F0.5 narrowed: phase 0 redacts only the secrets it holds; GitHub secret and repository-content redaction (including a scrub for secret shapes inside error messages) moves into phase 1 with V1.2–V1.4. Error kinds likewise arrive with the phase that first returns them. No hours change | No GitHub code exists in phase 0, so those rules would protect nothing and guess at field names |
