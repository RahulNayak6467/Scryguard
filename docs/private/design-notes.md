# Design notes

The intent and reasoning behind the plan, recorded when the plan was made,
so that every phase is designed in the same spirit even months later.

How this file is used:

- `/phase N` reads §1–§3 and the phase's section in §4 before drafting
  `phases/phase-N.md`. Where these notes conflict with the code, `scope.md`
  or an ADR, `/phase` raises the conflict and asks; it never resolves it
  silently.
- Open design questions are listed without answers. The user answers them
  at the phase's design check.
- At the end of each phase, `/wrap` appends a short **Learned** entry to
  the next phase's section: what changed, what to watch for, what was
  deferred.
- Changing a decision here means updating the note and adding a line to
  `scope.md`'s change log with the reason.

## 1. Product intent

**What Scryguard is.** A trust gate for pull requests written by AI coding
agents. It looks for the specific ways those agents fail and proves every
finding before a human relies on the change.

**Agent failure modes it targets.**

- Weakening tests so the build passes: deleting, skipping or loosening
  tests, updating snapshots blindly, mocking the unit under test,
  hard-coding expected values in source.
- Silencing checks instead of fixing code: `@ts-ignore`, `eslint-disable`,
  `any` casts, empty `catch` blocks, removed CI steps, lowered coverage
  thresholds, relaxed compiler strictness.
- Hallucination: calling functions or types that do not exist; importing
  packages that do not exist or were registered very recently
  (slopsquatting).
- Overclaiming: a description that the diff does not support; unrelated
  edits; changed signatures whose callers were not updated.

**What it is not.** A general AI code reviewer. It does not comment on
style or offer opinions. A finding without evidence is never shown.

**Positioning.** On a resume and in interviews, lead with the engineering
(crash-safe processing, sandbox isolation, evidence-based multi-agent
design, measured precision), not the product category. The one-line answer
to "how is this different from CodeRabbit?": *general reviewers report what
a model suspects; Scryguard only reports what it can prove, with tests run
on both commits in an isolated sandbox, and it targets the specific ways
coding agents fail.*

**Related projects.** Patchwright (self-healing CI) writes fixes;
Scryguard verifies agent-written changes. They are complementary: Scryguard
could audit Patchwright's pull requests.

## 2. Cross-cutting decisions

Each with the reason and the main alternative rejected. ADRs record the
larger ones formally.

| Decision | Reason | Rejected |
|---|---|---|
| Local models through Ollama (OpenAI-compatible API) | No per-token cost; the provider interface keeps hosted models available for comparison | A hosted provider by default (cost) |
| One hosted comparison run, capped at $10 | Honest cost and quality numbers for E8 | No comparison (weaker evaluation story) |
| LangGraph.js in TypeScript | The agent graph is built in phase 5, before the user's Python is ready for a production service; graph concepts transfer to Python later | Python LangGraph service (second runtime in the core, ~+15–20 h) |
| Rule-based router | Deterministic and cheap; an LLM router is a measured stretch item (S4) | LLM router from the start |
| Four specialists, each tied to a deterministic evidence source | Keeps precision high; the model interprets evidence rather than guessing | A general reviewer agent (opinions, low precision, generic positioning) |
| Adjudicator as a separate node | Discards unevidenced findings, merges duplicates, sets the verdict; enables a clean ablation | Filtering inside each specialist |
| PostgreSQL as source of truth, with pgvector and full-text search | One store; consistent with the run state; SQL performance work stays visible | Pinecone, ripgrep, a separate search engine |
| Redis only for data that can be lost | Cache, rate limits, pub/sub; reviews still run if Redis is down | Redis-held job state |
| SQS standard queue with a DLQ | Teaches at-least-once delivery, visibility timeouts and redrive; the consumer is idempotent, so FIFO adds nothing | BullMQ (hides the delivery model), FIFO (dedup window too short to replace idempotency) |
| Transactional outbox for every GitHub write | The verdict and its publication can never disagree | Posting to GitHub inside the review |
| Modular monolith in a pnpm monorepo; processes `api`, `worker`, `publisher`, `dashboard` | One database keeps the outbox transactional; separate processes where load differs | Microservices |
| Sandbox: Docker locally, ECS Fargate on AWS; no NAT; VPC endpoints for ECR, S3 and CloudWatch Logs only; zero-permission task role | Untrusted code never reaches the internet or any credential | Running tools on the worker host; a NAT gateway |
| Dependencies installed outside the sandbox with lifecycle scripts disabled | Lets the no-network sandbox run tests; packages needing install scripts are reported as inconclusive | Network access inside the sandbox |
| Lean AWS: one EC2 host with Caddy, RDS, SQS, S3, ECR, Fargate for sandboxes, SSM, flat Terraform | Keeps the cloud signal (Terraform, IAM, private networking, OIDC) at ~$35–50 a month; destroyed between demos | ALB, ElastiCache, NAT gateway, Secrets Manager, multiple environments |
| CASL for authorisation checks | Saves time; roles, data model, enforcement and tests stay the user's | Hand-written permission checks |
| `parse-diff` for diffs | Plumbing with no concept value | Hand-written diff parser |
| promptfoo as the evaluation runner | Saves ~15 h; datasets, "caught" checks, rubric and metrics stay the user's | Hand-written runner |
| The trust report lives in the Check Run (conclusion + summary) only | Inline comments need diff-position mapping with no new concepts | Inline review comments, PR comments |
| AI writes the dashboard, boilerplate, configuration and test code | Not interview material; the user designs every test case | — |
| The user writes the core, the sandbox image, core Terraform and the Python tools | These carry the learning and the interview stories | — |

## 3. Interview coverage contract

Rule: every essential backend and GenAI concept reaches at least level 3
(working, tested, edge cases handled) somewhere in the project. `/phase`
checks that the phase's tasks actually deliver the concepts mapped to it.

| Essential concept | Delivered by |
|---|---|
| REST design, error contract | P2.7, F0.7 |
| Webhooks | V1.2, P2.3 |
| API keys | P2.11 |
| OAuth, sessions | P2.5 |
| RBAC, multi-tenancy | P2.6 |
| Real-time (SSE) | D9.1 |
| Rate limiting | P2.8 |
| Caching | P2.10, A5.9 |
| Retries, timeouts | Q3.7, A5.3 |
| Idempotency | P2.3, Q3.3 |
| Backpressure, concurrency | Q3.2, Q3.4, H11.2 |
| Schema, constraints | P2.1 |
| SQL performance | P2.7 (`EXPLAIN ANALYZE`) |
| Transactions | Q3.6, Q3.7 |
| Redis | P2.8, P2.10, D9.2 |
| Full-text and vector search | I6.2, I6.5 |
| Object storage | X4.7, W10.4 |
| Queues and DLQ | Q3.1, Q3.8 |
| Fan-out | A5.1 (parallel specialists), E8.4 (repeated runs) |
| Outbox | Q3.7 |
| Provider integration, LLM streaming, token and cost tracking | A5.3, D9.1, A5.7 |
| Embeddings, RAG | I6.3, I6.5 |
| Agents and tool calling | A5, A7 |
| Evaluation | E8 |
| Guardrails, prompt injection | A5.8, A7.4 |
| Prompt management | A5.10 |
| LLM observability | A5.7 |
| Metrics, SLOs, error budgets | H11.7, H11.8 |
| Backups, RPO/RTO | H11.9 |
| Failure and chaos testing | Q3.10, H11.3 |
| Load testing, percentiles | H11.2 |

**Studied, not built.** These come in as fundamentals (F) in the theory
rows of `plan.md`: Kafka and streams (phase 3), CAP and consistency models
(3), replication and sharding (6), consistent hashing (6), load balancing,
CDNs and Multi-AZ (10), unique IDs and feed fan-out (11), OAuth flows and
sessions vs JWT (2). Circuit breakers, deadline propagation, audit logs and
kill switches are built only if stretch S6–S8 is reached; otherwise they
are studied.

## 4. Phase notes

Fields per phase: intent · decided · races and failure cases · break first
· open design questions · resist · ship parts · interview story · learned
(appended by `/wrap`).

### Phase 0 · Foundation

- **Intent.** A clean, explainable base so later phases only add product
  code.
- **Decided.** Reuse LLMux's phase 0 foundation (decided 2026-10-31,
  LLMux stopped); rename everything; nothing from LLMux's product code
  comes along. LLMux's phase 1 work on hashed API keys is the reference
  for P2.11.
- **Break first.** Delete the shutdown coordinator and rebuild it from a
  blank file, using the old tests as the judge.
- **Resist.** Adding product folders before the phase that needs them.
- **Ship parts.** Tooling, CI, Compose, configuration.
- **Learned.**

### Phase 1 · Vertical slice

- **Intent.** The thinnest end-to-end path, naive on purpose. Later phases
  make each part correct.
- **Decided.** Local model through the provider interface from day one;
  the model is chosen by measurement (tool calling and JSON-schema
  reliability on 8 GB of VRAM), not by reputation. A fake model server and
  a fake GitHub API are built here, so no test ever calls a real service.
  Redaction for GitHub secrets ships in the same step as the first code
  that holds them (decided 2026-11-01, phase 0 built only the generic
  base): the App private key, installation tokens and the webhook secret
  by path, plus a scrub for secret shapes (PEM blocks, `ghs_`/`ghp_`/
  `github_pat_`) inside error message strings, since a path list cannot
  see a key inside a string. Repository content (diff, patch, PR body)
  is redacted by the worker's own paths. Test: a fake PEM, a `ghs_`
  token, a webhook secret and a diff never reach a log line.
- **Races and failure cases.** Tampered or missing signature; GitHub API
  error while reporting; model server down or returning invalid JSON.
- **Break first.** Send a webhook with a tampered body to a handler without
  signature checks and predict what it does.
- **Open design questions.** Where the raw body is captured relative to
  JSON parsing? How long to reuse an installation token, and what happens
  when it expires mid-request?
- **Resist.** Queues, retries or a database model beyond a single run row;
  those belong to phases 2–3.
- **Interview story.** How GitHub App authentication works end to end (app
  JWT → installation token → API call).
- **Learned.** 2026-11-03, from phase 0. `express.json()` is mounted for
  every route in `app.ts`, so the webhook's raw body must be captured
  before it or the HMAC check sees re-serialized JSON. Every wait needs
  its own timeout (P0.8: query_timeout ended a hung shutdown before the
  deadline; keep-alive did not, until the drain fix). Phase 0 ran 6.5 h
  over budget, so phase 1 has no slack; `/review fresh` of phase 0 is
  still owed. Work through PRs so the OpenAPI breaking check runs.
  Sizing: phase 0 ran 1.65× (rewrites in a second file, then a split
  and a refactor; tests as large as the code; side questions mid-build).
  Estimate tasks with their tests; write in the final file from the
  start; each task notes its estimate and 1.5× stop line before it
  starts; ask for a nudge after 15 min stuck; park side questions.

### Phase 2 · Control plane

- **Intent.** A real data model and API where no installation can ever see
  another's data and duplicate deliveries are harmless.
- **Decided.** Installation ID in every repository function signature;
  server-side sessions in PostgreSQL rather than JWTs; keyset pagination;
  Redis Lua token bucket; API keys stored as hashes, shown once, revocable
  (LLMux phase 1 is a reference for the design).
- **Races and failure cases.** The same delivery processed twice in
  parallel; offset pagination skipping rows during inserts; a session used
  after logout; Redis down during rate limiting; an uninstall arriving
  while a review runs; a revoked API key used again; a key from one
  installation used against another.
- **Break first.** Two parallel deliveries against a check-then-insert
  handler; offset pagination while rows are inserted.
- **Open design questions.** Fail open or closed when Redis is down? What
  exactly makes a pull request "agent-authored", and who configures it?
  Which cache entries must be invalidated on uninstall?
- **Resist.** Fine-grained permissions beyond three roles; an admin UI.
- **Interview story.** How BOLA happens and how the schema and repository
  signatures make it impossible here.
- **Learned.**

### Phase 3 · Reliable processing

- **Intent.** Exactly one correct verdict per head commit, despite
  at-least-once delivery, crashes and new pushes.
- **Decided.** SQS standard, not FIFO; attempt-number fencing on writes;
  head SHA checked before the review and before the verdict; outbox with a
  separate publisher.
- **Races and failure cases.** Two workers receive the same message;
  visibility expires during a long review; a new commit lands mid-review;
  crash after the verdict is saved but before it is published; GitHub
  returns 5xx to the publisher; a message that always fails.
- **Break first.** A naive consumer plus `kill -9` produces a duplicate
  Check Run; a stopped heartbeat lets a second worker take over while the
  first is still running.
- **Failure experiments.** 200 reviews with random kills of workers and
  the publisher; a frozen worker (`SIGSTOP`); PostgreSQL restarted during
  a claim.
- **Open design questions.** How is a queued run guaranteed a message:
  outbox or sweeper? Where are allowed state transitions defined? How does
  the publisher know a Check Run was already created?
- **Resist.** A general-purpose workflow engine; FIFO "to be safe"; exactly-
  once claims that the design cannot back.
- **Interview story.** How to guarantee exactly one verdict with
  at-least-once delivery.
- **Learned.**

### Phase 4 · Sandbox

- **Intent.** Run repository code that may be hostile without it reaching
  credentials, the network or the host.
- **Decided.** Docker runner behind an interface (Fargate added in phase
  10); dependencies installed outside with lifecycle scripts disabled; no
  network for tests, `tsc` and Semgrep; base and head both executed.
- **Races and failure cases.** Fork bomb; memory exhaustion; output flood;
  infinite loop; writes outside the work directory; reading host files;
  outbound network calls; worker crash leaving containers behind; a test
  suite that is flaky between base and head.
- **Break first.** A container with no limits running a build that prints
  the environment, calls an external URL and fills memory; predict which
  succeed.
- **Open design questions.** How to tell "test removed" from "test renamed"
  between base and head? How to treat flaky tests so they are not reported
  as weakening? What is the time limit, and what does a timeout mean for
  the verdict?
- **Resist.** gVisor, seccomp profiles or an egress proxy (out of scope).
- **Interview story.** Namespaces, cgroups and capabilities, and why
  secrets never enter the sandbox.
- **Learned.**

### Phase 5 · Agents v1

- **Intent.** v1: a working trust gate that catches weakened tests and
  suppressed checks, with evidence, on real pull requests.
- **Decided.** LangGraph.js; rule-based router; two specialists (test
  integrity, guardrail bypass); adjudicator drops anything without
  evidence; every node journaled; prompts versioned; responses cached.
- **Races and failure cases.** Model server down or slow; invalid
  structured output; a specialist exceeding its budget; prompt injection in
  a code comment; two specialists reporting the same issue.
- **Break first.** A specialist with no evidence rule on a clean PR:
  count its false positives.
- **Open design questions.** What exactly counts as evidence for each
  finding type? How are verdicts derived from findings (pass, needs
  review, block)? What does the router do when the diff touches
  everything?
- **Resist.** More specialists before evaluation exists; an LLM router.
- **Interview story.** Why multi-agent here, and how the adjudicator keeps
  precision high.
- **Learned.**

### Phase 6 · Code intelligence

- **Intent.** Give the specialists accurate context: what exists in the
  codebase, where it is used, what changed around it.
- **Decided.** tree-sitter symbol table and function-level chunks;
  pgvector HNSW plus `tsvector`; reciprocal rank fusion; index per
  installation, repository and commit.
- **Races and failure cases.** Two pushes in quick succession; a renamed
  file; a file that fails to parse; the embedding server down mid-index; a
  query that could return another installation's chunks.
- **Break first.** Pure vector search for an exact identifier, and pure
  full-text search for a concept: each misses what the other finds.
- **Open design questions.** Chunk boundaries for large functions? How is
  "the newest commit wins" enforced? Which HNSW parameters, and how are
  they justified?
- **Resist.** Rerankers, query rewriting, GraphRAG.
- **Interview story.** Hybrid retrieval and how recall was measured.
- **Learned.**

### Phase 7 · Agents v2

- **Intent.** Complete the specialist set and harden the system against
  injection through the content it reads.
- **Decided.** Hallucination and dependency specialist uses the symbol
  table, `tsc` and npm registry metadata; intent and completeness
  specialist uses the PR text, linked issue and call sites.
- **Races and failure cases.** Registry unavailable; a package published
  minutes ago; instructions hidden in a comment, PR description or test
  output; a description that is vague rather than false.
- **Open design questions.** What registry signals mark a package as
  suspicious? How to avoid flagging legitimate new dependencies? How does
  the intent specialist judge a vague description?
- **Resist.** A general security scanner; the claim-verifier (S1) before
  this phase is done.
- **Interview story.** Slopsquatting and indirect prompt injection.
- **Learned.**

### Phase 8 · Evaluations

- **Intent.** Honest numbers that prove the design works and show where it
  does not.
- **Decided.** Python for dataset mining, the failure generator and
  analysis; promptfoo for runs; three runs per case; a generic-reviewer
  baseline; ablation per specialist; one hosted comparison within $10.
- **Failure cases to report.** Misses per failure type with the reason;
  variance across runs; cost per review.
- **Open design questions.** What exactly counts as "caught" (file, line
  range, type)? How are development and held-out cases split? What is
  the baseline prompt, and is the comparison fair?
- **Resist.** Tuning prompts on the held-out set; reporting a single run.
- **Interview story.** How the evaluation was designed and what the
  ablation showed.
- **Learned.**

### Phase 9 · Dashboard and live updates

- **Intent.** Make the multi-agent work visible for demos and users.
- **Decided.** SSE with resume; Redis pub/sub fan-out; pages written by AI
  against the user's API contracts.
- **Races and failure cases.** Client reconnecting mid-review; slow client;
  API instance restarting while streaming.
- **Resist.** More pages than the three in scope (the agent statistics
  page was cut under C1).
- **Ship parts.** All UI code.
- **Learned.**

### Phase 10 · AWS

- **Intent.** The whole system deployed from nothing with Terraform, with
  the sandbox locked down in a private subnet.
- **Decided.** Lean footprint (see §2); private connection to the model
  server on the GPU machine; deploys through OIDC and SSM Run Command.
- **Races and failure cases.** Fargate task never starts or hangs; ECR
  pull fails without NAT; RDS restart; the model server unreachable from
  AWS.
- **Break first.** Run a probe in the sandbox task that tries to reach the
  internet and the instance metadata endpoint.
- **Open design questions.** Which VPC endpoints are strictly required?
  What is the least-privilege policy for the EC2 role and the worker's
  `RunTask` permissions? What is the destroy-and-recreate routine?
  Does Caddy in front of the API need a drain delay (readiness 503 →
  wait → `server.close()`)? If so, add `DRAIN_DELAY_MS` and require
  shutdown > drain + statement timeout + `SHUTDOWN_MARGIN_MS`; raise
  `SHUTDOWN_TIMEOUT_MS` and the container `stop_grace_period` to fit.
  Deferred from P0.7 (2026-11-02): no load balancer locally, so the
  delay would always be 0.
- **Resist.** Multi-AZ, autoscaling, an ALB.
- **Interview story.** How the sandbox is isolated on AWS, layer by layer.
- **Learned.**

### Phase 11 · Hardening and release

- **Intent.** Prove the headline results on AWS, run the system the way an
  operations team would, and package it so a reviewer can see it working.
- **Decided.** Security checklist; k6 bursts with results in
  `docs/baselines/`; failure drills with written results; Prometheus
  metrics and Grafana dashboards; two SLOs (webhook acknowledgement, review
  completion p95) with burn-rate alarms; an RDS restore drill with measured
  RPO and RTO; a runbook per alarm; a public demo repository with sample
  agent pull requests and live trust reports; README with numbers; demo
  video; milestone release `v1.0.0`.
- **Open design questions.** What SLO targets are honest for a single host
  and local models? How is the burn rate computed and over which windows?
  What does the demo repository show first?
- **Resist.** New features; anything not tied to a headline result or an
  operational proof.
- **Interview story.** The three headline results, the SLOs and what their
  error budgets mean, and the restore drill's RPO and RTO.
- **Learned.**

## 5. Python handover

Python is learned at ~5 h a week outside the project budget, in 25-hour
blocks. Python tools are written by the user and double as practice.

| Block | When | Ready for |
|---|---|---|
| 1 (0–25 h) | Nov–Dec | Scripts, JSON, files |
| 2 (25–50 h) | Jan | Typed, tested CLI scripts |
| 3 (50–75 h) | Feb | HTTP clients, pydantic, git automation → E8.1 can start |
| 4 (75–100 h) | Mar–Apr | pandas, matplotlib, psycopg → E8.2, first analysis |
| 5 (100–125 h) | May–Jun | boto3, concurrency, Lambda → chaos scripts, S2 |
| 6 (125–145 h) | Jun–Jul | NumPy, profiling → bridge to later inference work |

## 6. Reviews

- **R1** (phases 1–3): webhooks, sessions, isolation, the queue, fencing
  and the outbox.
- **R2** (phases 4–6): sandbox isolation, the agent graph and evidence
  rule, retrieval.
- **R3** (phases 7–11): injection defenses, evaluation method, AWS
  isolation, headline results.

Each review: `/review fresh` and fixes, then a study pack of concepts,
theory questions and likely interview questions grounded in what was built.
