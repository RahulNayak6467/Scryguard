# Phase 0 · Foundation

## 1. Goal

Bring LLMux's tested foundation into Scryguard, renamed, with every LLMux
product leftover removed. Add what Scryguard needs and LLMux lacked: SQS,
object storage and Ollama in the stack, a `publisher` shell, and GitHub
secrets in redaction and secret scanning. Rebuild the shutdown coordinator
from a blank file.

Budget **10 h (T 2 · B 8)** · deadline **Nov 5**.

## 2. Theory (2 h)

You read these sources for LLMux. This round is a refresh from your own
notes, then a check that you can explain each module without them. The
apps run as containers on one Docker host (ADR 0006), so shutdown is
studied as Docker stops a container.

| Topic | Depth | Source | Get from it | h | Before |
|---|---|---|---|---:|---|
| Event loop | supporting | Your LLMux `notes/event-loop.md`; [Node: Event loop, timers and nextTick](https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick) | The order of the phases; output prediction P1–P4 with no notes | 0.4 | P0.7 |
| Signals and shutdown | core | Your LLMux `notes/graceful-shutdown.md`, `shutdown-walkthrough.md`; [Node process: Signal events](https://nodejs.org/api/process.html); [Node http: `server.close()`, `closeIdleConnections()`](https://nodejs.org/api/http.html); [`docker stop`](https://docs.docker.com/reference/cli/docker/container/stop/) (SIGTERM, wait, SIGKILL); [Compose services: `stop_grace_period`](https://docs.docker.com/reference/compose-file/services/) | From SIGTERM to exit: the order of steps, the deadline, exit 0 vs 1; why `SHUTDOWN_TIMEOUT_MS` must be below the grace period | 0.6 | P0.7 |
| Drill-0 weak spots | core | LLMux `drills/drill-0.md`, weak spots 1–4 | Answer all four out loud, retold for a Docker host instead of ECS behind an ALB | 0.3 | P0.7 |
| Reading the reused foundation | supporting | The copied code itself | Per module: what it does, why, how it fails | 0.7 | P0.9 |

## 3. Tasks (8 h)

| ID | Task | Scope | Tier · mode | h |
|---|---|---|---|---:|
| P0.1 | Copy from LLMux's committed `HEAD` (git archive; its working tree has an uncommitted test change), rename, switch the Valkey images to Redis, install, `pnpm validate` green | F0.1–F0.4, F0.6, F0.10 | Glue · ship | 1.25 |
| P0.2 | Remove LLMux product leftovers (`quota_exceeded`, LLM payload redact paths, `lmx_` rule, `EMAIL_TAKEN` / `NAME_TAKEN` / `TENANT_NOT_FOUND` in tests). gitleaks: a test scans a temp repo holding fake `ghp_`, `ghs_`, `github_pat_` tokens and a PEM private key; all four are caught; add a rule only where the defaults miss one. Build the fakes at runtime (never as token-shaped literals in the test file), so CI's own scan stays green without an allowlist | F0.1, F0.7, F0.8 | Glue · ship | 0.75 |
| P0.3 | Compose: ElasticMQ (main queue + DLQ), RustFS (one bucket), Toxiproxy kept; `OLLAMA_BASE_URL` in `.env.example` with a documented reachability check | F0.9 | Glue · ship | 0.75 |
| P0.4 | `publisher` process shell from the worker shell; CI smoke test starts all three apps | F0.8, F0.11 | Glue · ship | 0.5 |
| P0.5 | Redaction for Scryguard secrets and repository contents | F0.5 | Solid · learn | 1 |
| P0.6 | Error kinds and codes for Scryguard; error contract as ADR 0009 (adapted from LLMux ADR 0003) | F0.7 | Solid · learn | 1 |
| P0.7 | Break first: delete the shutdown coordinator, rebuild it from a blank file, old tests as the judge | F0.6, F0.11 | Core · learn | 2 |
| P0.8 | Failure experiments (§6), predicted before running | F0.6, F0.11 | Core · learn | 0.5 |
| P0.9 | Exit: CI green on a clean clone; name grep; after `pnpm install`, a commit mixing a private and a public file is still refused; explain every module | all | — | 0.25 |

**Images (decided 2026-10-31, for P0.1 and P0.3).**
- PostgreSQL: `pgvector/pgvector:0.8.7-pg18-trixie@sha256:5895949dfcdf308eb0cd31c950c93c14895c77f33fbedfecf1fa511ab1d4bcd2`
  (PostgreSQL 18.6). Trixie, not LLMux's bookworm: bookworm is past
  regular security support, and the base OS sets glibc collation, so it is
  chosen before any data exists. RDS support for pgvector 0.8.7 on
  PostgreSQL 18: to verify before phase 6.
- Redis: `redis:8.10.3-alpine@sha256:21090af93f8324db2f0f0f4f38a7c60369d47d917e000c3423d89d2ae2883537`.
  Password on, `maxmemory 256mb`, `noeviction` until P2.8. Append-only
  off: Redis holds only rebuildable data and losing it on restart is
  accepted (ADR 0001, ADR 0006).

**Secret scanning (decided 2026-10-31).** CI runs `gitleaks-action` on the
commits of each push or PR, not full history. Run a full-history scan by
hand (`gitleaks git . --config .gitleaks.toml --redact`) after any change to
`.gitleaks.toml` and before going public (plan.md, Going public step 4).

**P0.5 Redaction (narrowed 2026-11-01).** Phase 0 builds only the generic
base: the secrets that exist now. Each later phase adds the redaction for
the secrets it introduces, in the same step as the code that first holds
them (design-notes, phase 1).
- Covers: passwords, connection URLs (`DATABASE_URL` and `REDIS_URL` carry
  passwords), auth and cookie headers, request and response bodies.
- Stays generic: no GitHub or repository names in `logger`; apps add their
  own paths when they need them.
- Done when: a test logs an object holding a fake connection URL with a
  password, an `authorization` header and a request body, and the output
  contains none of them.
- Handed over: generic redaction (2026-11-01), revisit. Written by Claude
  at the user's request; the phase 1 string scrub stays learn mode.

**P0.6 Errors.**
- `quota_exceeded` was LLMux budgets. Drop it, or map Scryguard's future
  limits to it? (`forbidden` arrives with roles in P2.6, not now.)
- LLMux planned OpenAI-style `type` and `param` fields in the envelope;
  the copied code never added them. Scryguard has no OpenAI-compatible
  API. Do they stay out for good, and does ADR 0009 say why?
- What in LLMux ADR 0003 is LLMux-only and must not carry into ADR 0009?
- Done when: every kind has a status and a `retryable` value checked by a
  test; an internal error returns only the code and request ID; ADR 0009
  is accepted and linked from `docs/adr/README.md`.

**P0.7 Shutdown coordinator.**
- Two signals arrive 50 ms apart. What must the second one do?
- One close step throws. Do the later steps still run, and what is the
  exit code?
- Done when: the old tests pass on your rewrite; you can say why the
  deadline timer is `unref`'d and why the start waits a microtask.
- Handed over: keep-alive drain fix (2026-11-03), revisit. Found in P0.8
  experiment 3: a connection busy at `server.close()` stayed open for the
  keep-alive timeout after its response (+6 s per shutdown; with
  keep-alive ≥ the shutdown timeout, exit 1). Written by Claude at the
  user's request: `Connection: close` while draining and ending the
  socket when a response finishes during the drain (`app.ts`), the rule
  keep-alive < shutdown timeout, keep-alive max 120 s → 60 s.

## 4. Data model and migrations

None new. The two copied migrations (UTC time zone, `vector` extension)
come along unchanged.

## 5. Races

| Race | What must hold |
|---|---|
| SIGTERM arrives during startup, before the server listens | Shutdown runs once; no half-open pool is left |
| SIGTERM, then an uncaught exception during the drain | The coordinator runs once; the exit code is 1 |
| Two readiness probes overlap while PostgreSQL is slow | One in-flight check is shared; one log line per state change |
| A request is in flight when shutdown starts | It finishes if under the deadline; new connections are refused |
| `docker stop` grace period ends before the drain does | SIGKILL; avoided by keeping `SHUTDOWN_TIMEOUT_MS` below `stop_grace_period` |

## 6. Failure experiments (predict first)

| Break | Expected |
|---|---|
| Toxiproxy cuts PostgreSQL | `/health/ready` 503 within the readiness timeout; `/health/live` stays 200 |
| Toxiproxy cuts Redis | Readiness stays 200 (Redis is not a readiness dependency) |
| SIGTERM with a 10 s request in flight | Request finishes, then exit 0; **measure** time from SIGTERM to exit |
| A pool `end()` that hangs | Deadline force-exit with code 1 at `SHUTDOWN_TIMEOUT_MS` |
| Start the API with `DATABASE_URL` missing | Refuses to start; the error names the variable, not its value |

**Measured 2026-11-03.** 1: proxy disabled → 503 in 3 ms; timeout toxic →
503 in 1001 ms; live 200 throughout; one log line per state change. 2:
ready stays 200; client reconnects on its own. 3: request finished, exit
0, but 14.0 s SIGTERM → exit (keep-alive held the connection 6 s after the
response); after the drain fix 8.0 s. 4: idle pool → exit 0 in 0.01 s;
stuck query → exit 0 at 16.8 s via `query_timeout`, deadline never
reached. 5: missing, hostless and non-URL values all exit 1, field named,
fake password absent.

## 7. Error codes added

All arrive with the copy; P0.6 confirms the set. The readiness 503 is
`{ status: 'not_ready' }`, not an error envelope.

| Kind | Code | Status | Retryable |
|---|---|---|---|
| `invalid_input` | `INVALID_INPUT` | 400 | no |
| `invalid_input` | `INVALID_JSON` | 400 | no |
| `invalid_input` | `INVALID_REQUEST_BODY` | 400 | no |
| `invalid_input` | `UNSUPPORTED_CONTENT_ENCODING` | 400 | no |
| `invalid_input` | `UNSUPPORTED_CHARSET` | 400 | no |
| `invalid_input` | `REQUEST_ABORTED` | 400 | no |
| `not_found` | `ROUTE_NOT_FOUND` | 404 | no |
| `payload_too_large` | `PAYLOAD_TOO_LARGE` | 413 | no |
| `internal` | `INTERNAL_ERROR` | 500 | no |

Only the four kinds above exist in phase 0 (decided 2026-11-01). Each
later kind arrives with the phase that first returns it, with a test:
`unauthenticated` (401) and `conflict` (409) in phase 2, `rate_limited`
(429, retryable) in P2.8, `unavailable` (503, retryable) when the first
503 envelope appears.

## 8. Invariants

1. Shutdown runs at most once per process, whatever triggers it.
2. Every shutdown step runs even if an earlier one throws.
3. The process exits by `SHUTDOWN_TIMEOUT_MS` at the latest.
4. A 5xx response body never contains a stack, SQL, a cause or a value
   from the request.
5. No log line contains a GitHub token, the App private key, a webhook
   secret, a connection URL or repository contents.
6. A body over the limit is rejected before it is parsed.
7. Invalid configuration stops the process before any connection opens.
8. No commit mixes private and public files.
9. With Redis down, a command fails within `REDIS_COMMAND_TIMEOUT_MS`;
   the Redis `close()` runs once and returns within 2 s; one outage logs
   one line, not one per reconnect.

## 9. Test plan

| Test | Mutation it must catch |
|---|---|
| Coordinator: two triggers | Remove the "already running" guard → steps run twice |
| Coordinator: a step throws | Stop on first error → the pool never closes |
| Coordinator: deadline | Remove the deadline timer → a hung step hangs forever |
| Redaction: connection URL, `authorization` header, request body | Drop one path → secret appears in output |
| Error middleware: DB error | Pass `error.message` through → SQL reaches the client |
| Kind table | Add a kind without a status → typecheck fails |
| gitleaks: fake `ghp_`, `ghs_`, `github_pat_`, PEM | Disable a rule → that secret passes the scan |
| Commit split after `pnpm install` | Drop the `.git/local-pre-commit` call → mixed commit accepted |
| Redis down: `get` fails within the command timeout | Offline queue turned back on → the command waits |
| Redis `close()` called twice | Remove the once-guard → `quit` runs twice |
| Redis `close()` while Redis hangs | Remove the quit timeout → close never returns |
| Redis: 10 failed reconnects | Remove the "already down" guard → 10 log lines |

## 10. Interview questions

1. Walk me through `docker stop` to exit on a Docker host. What is the
   order inside the process, and why that order?
2. Liveness vs readiness: why is Redis not in readiness for Scryguard?
3. A deploy starts while a 40 s request is in flight. What does the
   client see?
4. Why does the error body carry `retryable`, and who decides it?
5. Why reject a big body before parsing it?
6. How do you stop the GitHub App private key from reaching your logs?
7. You reused another project's code. How do you prove you understand it?

## 11. Done when and out of scope

**Done when**
1. A clean clone is green locally and in CI (`pnpm validate`).
2. `grep -rniE "llmux|engram|lmx_|egm_|valkey"` outside `docs/private/`
   and `.claude/` prints nothing.
3. The Compose stack is up and healthy: PostgreSQL, Redis, ElasticMQ,
   RustFS, Toxiproxy. Ollama setup on the GPU PC (`OLLAMA_HOST`, fixed LAN
   address, firewall to the Mac only) and its `curl` check move to the
   start of phase 1: the PC is unavailable until about 2026-11-07.
4. You can explain every reused module without notes.
5. The rebuilt coordinator passes the old tests.
6. ADR 0009 (error contract) is accepted.

**Out of scope:** SQS, S3 or Ollama clients (phases 1, 3, 4); `forbidden`
and roles (P2.6); any product table or folder; GitHub code; LLMux ADR
0002 (Scryguard's Redis failure policy is decided in P2.8).
