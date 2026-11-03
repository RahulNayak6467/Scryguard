# 0010. Shutdown time budget

Status: Accepted · 2026-11-04

## Context

On SIGTERM the API closes, in order, the HTTP server, the PostgreSQL pool
and Redis, all under one deadline (`SHUTDOWN_TIMEOUT_MS`). `server.close()`
waits for every active connection. A single client that sends its headers
and stops mid-body kept the HTTP step waiting until the deadline: the
process exited 1, and the pool and Redis were never closed. Cutting a
socket also does not stop the handler behind it, so a query it started
keeps the pool's `end()` waiting after the HTTP step is over.

## Decision

- The deadline is split. The HTTP step gets what the later steps cannot
  need: `httpDrainMs = SHUTDOWN_TIMEOUT_MS − DB_CONNECTION_TIMEOUT_MS −
  DB_STATEMENT_TIMEOUT_MS − margin` (query-timeout margin plus the Redis
  quit timeout, 4 s).
- When `httpDrainMs` runs out, the API logs `http_drain_timeout` and calls
  `closeAllConnections()`; shutdown then moves on.
- Configuration is rejected at startup when `httpDrainMs` is below
  `MIN_HTTP_DRAIN_MS` (5 s by default).
- The default statement timeout is 5 s, so the defaults fit in 20 s.
- After the steps, the deadline timer stays armed but `unref`'d: a clean
  process exits at once, and a handle leaked by any module still ends in
  exit 1 at the deadline instead of a platform kill.
- The container stop grace period must exceed `SHUTDOWN_TIMEOUT_MS`.

## Consequences

- One slow or hostile client can no longer turn a deploy into exit 1 or
  skip the later steps.
- A request still running after `httpDrainMs` is cut. For a webhook this is
  a lost delivery, because GitHub does not redeliver on its own.
- A handler that runs several queries in sequence can still exceed the
  budget; the deadline is the backstop.
- Queries slower than 5 s fail by default.

## Alternatives considered

- **One deadline for all steps (before).** Simple, but the first step can
  consume all of it.
- **Raise `SHUTDOWN_TIMEOUT_MS` to 30 s.** Keeps the 15 s statement
  timeout, but every slow deploy waits longer and the gap to Docker's 10 s
  default grace period grows.
- **A library such as `http-terminator`.** Same pattern; the budget across
  the later steps would still be ours to compute.
- **Clearing the deadline after the steps.** A leaked timer or socket then
  keeps the process alive until SIGKILL.
