# Phase 0 packages: what I learned

Learned while building `shared`, `logger`, `config`, `database` and `redis`
on 2026-11-01 and 2026-11-02. Format: the notes template, one section per
topic. Parts: code style and scope, logging and secrets, config,
PostgreSQL, Redis, testing.

Sources name the official doc sections to read; they are pointers, not
pages I have checked yet.

---

# Part 1: Code style and scope

## Less code is not lower quality

Depth: supporting
Source: Scryguard CLAUDE.md, "Keeping it simple"
Timer:

What: Cutting code only lowers quality when the cut code stopped a real
failure. The test for every line: "what breaks if I delete this?"

| Cut this | Quality |
|---|---|
| The same name listed 3 ways, options nobody sets, a test that checks the code's shape | Goes up: less to read and review |
| The serializer's database rule | Goes down: user input reaches the logs |

Why (what breaks without it): without this test, "lean" turns into
"missing the one check that mattered".

One failure story: LLMux redaction was 200 lines; mine is ~50 with the
same protection, because `*.name` replaces the root, `config.` and
`auth.` copies of every name.

Alternative / why not just…: "why not keep everything, just in case?"
Every extra line is something a reviewer must read and a test must cover.

Scryguard link: `packages/logger/src/redaction.ts`

Interview question I can now answer: How do you decide what to cut when
you reuse code from another project?

Later:

## Grow per phase, but security arrives with the secret

Depth: core
Source: Scryguard scope.md change log, 2026-11-01
Timer:

What: Error kinds and redaction rules are added in the phase that first
needs them, not all up front. Exception: the rule that protects a secret
ships in the same step as the code that first holds that secret.

```
P0: no GitHub code → no GitHub redaction (it would protect nothing)
P1: add App private key   ← redaction must land HERE
P1: token fetch fails, error message holds the PEM
P?: "add redaction later" → the key is already in the logs
```

Why (what breaks without it): adding everything up front means guessing
field names that don't exist yet; adding security "later" leaves a window
where a real leak can happen.

One failure story: the key reaches the logs between "we added GitHub
auth" and "we added the redaction for it".

Alternative / why not just…: "why not add all nine LLMux error kinds now?"
Kinds nobody returns are options nobody sets. A typed table makes adding
one later a one-line change (see below).

Scryguard link: `docs/private/phases/phase-0.md` P0.5, design-notes phase 1

Interview question I can now answer: How do you keep a foundation small
without leaving security gaps?

Later: the phase 1 string scrub (PEM, `ghs_`, `ghp_`, `github_pat_`).

## A typed table makes a missing entry a compile error

Depth: supporting
Source: TypeScript handbook, "Utility types: Record"; the `satisfies`
operator (TS 4.9 release notes)
Timer:

What: `RETRYABLE_BY_KIND = { … } as const satisfies Record<ERROR_KIND, boolean>`.
Add a kind to the union without adding it to the table → typecheck fails.

Why (what breaks without it): a plain object returns `undefined` for the
missing kind at runtime, and `undefined` is falsy, so the new kind is
silently "not retryable".

One failure story: phase 2 adds `rate_limited`; I forget the table; the
client never retries a 429.

Alternative / why not just…: a `switch` with a `never` check works too,
but the table is shorter and reads as data.

Scryguard link: `packages/shared/src/errors/errors.ts`

Interview question I can now answer: How do you make the compiler catch a
forgotten case?

Later:

## A file outside the tsconfig `include` is invisible

Depth: supporting
Source: TypeScript docs, "tsconfig: include"; typescript-eslint docs,
"projectService"
Timer:

What: I put `clock.test.ts` at `packages/shared/clock/`, outside `src/`.

```
tsconfig include: src/**, test/**   → TypeScript can't see it
ESLint (uses TypeScript)            → "was not found by the project service"
Vitest unit glob: */src/**/*.test.ts → test never runs, no warning
build (rootDir src)                 → code never reaches dist/
```

Why (what breaks without it): the silent one is Vitest. A test that never
runs looks the same as a test that passes.

One failure story: I'd have committed a "tested" clock with zero tests run.

Alternative / why not just…: "add the folder to `allowDefaultProject`"?
That only hides the ESLint error; the build and the tests still miss it.

Scryguard link: `packages/shared/src/clock/`, `vitest.config.ts`

Interview question I can now answer:

Later:

---

# Part 2: Logging and secrets

## Pino redaction works by path, not by content

Depth: core
Source: Pino docs, "Redaction"
Timer:

What: Pino hides a value only when it sits under a name I listed
(`password`, `req.headers.authorization`). It never looks inside strings.

```
logger.error({ privateKey: pem })            → hidden
logger.error({ err: new Error(`bad ${pem}`) }) → err.message holds the key → NOT hidden
```

Why (what breaks without it): believing "redaction is on" means "secrets
can't leak".

One failure story: a GitHub 401 error message quotes the key; no field is
called `privateKey`; the key is in the log.

Alternative / why not just…: scan every string for secret shapes. Costs
more per log call, so do it only where it matters: error messages, in
phase 1.

Scryguard link: `packages/logger/src/redaction.ts`, invariant 5

Interview question I can now answer: How do you stop the GitHub App
private key from reaching your logs?

Later: phase 1 string scrub.

## `*.name` reaches one level down only

Depth: supporting
Source: Pino docs, "Redaction" (path syntax, wildcards)
Timer:

What:

```
{ password }                     ← "password"        hidden
{ config: { password } }         ← "*.password"      hidden
{ config: { database: { url } } } ← two levels, and the name is "url" → NOT hidden
```

Why (what breaks without it): LLMux shapes app config as
`config.database.url`. Logging the config object would print both
connection passwords.

One failure story: startup logs `{ config }` "for debugging".

Alternative / why not just…: add `*.*.url`? Broad and slow. Chosen rule
instead: config is never logged whole (option b), with a test in each app.
Redaction is the second guard, not the first.

Scryguard link: apps' `main.ts` (to write), `redaction.ts`

Interview question I can now answer:

Later: the "config is never logged whole" test in each app.

## A database error message can quote user input

Depth: core
Source: PostgreSQL docs, "Appendix A. PostgreSQL Error Codes" (SQLSTATE)
Timer:

What: `invalid input syntax for type uuid: "<what the user typed>"`. The
serializer spots a database error by its SQLSTATE code (5 characters,
like `22P02`) and drops its message and stack, keeping only `code`,
`constraint` and `table`. Node codes like `EPIPE` don't match the pattern.

Why (what breaks without it): user input, or a value from a row, lands in
the logs through the error message.

One failure story: a unique-violation `detail` says
`Key (email)=(someone@example.com) already exists.`

Alternative / why not just…: drop every error message? Then Node errors
like `ECONNREFUSED 127.0.0.1:5432` lose the part that helps debugging.

Scryguard link: `packages/logger/src/error-serializer.ts`

Interview question I can now answer: What can leak through an error
message, and how do you prevent it without losing debuggability?

Later:

---

# Part 3: Config

## Zod details that matter at startup

Depth: supporting
Source: Zod docs, "Strings", "Refinements" (`abort`, `superRefine`),
"Objects" (`.shape`)
Timer:

What:
- `Number()` accepts `0x10`, `1e3` and spaces → `integerEnv` checks
  `/^\d+$/` first.
- `.min(1, { abort: true })` stops the URL checks from adding three more
  issues to an empty value: one problem, one message.
- Spreading `.shape` copies fields, not refinements → cross-field rules
  (`applyLoggerRules`) must run in the merged schema's `superRefine`.
- Issues carry field and reason, never the value → a secret in a bad
  env var never reaches stderr.

Why (what breaks without it): `PORT=0x1F90` would quietly become 8080;
an empty `DATABASE_URL` would print four confusing errors.

One failure story: a rule written on `loggerEnvSchema` silently stops
running once the app spreads its `.shape`.

Alternative / why not just…: `z.coerce.number()`? Coerce uses `Number()`,
so hex and exponents pass.

Scryguard link: `packages/config/src/fields.ts`, `env.ts`

Interview question I can now answer: Why validate config once at startup,
and what should the error show?

Later:

## Inline first, extract on the second use

Depth: supporting
Source: Scryguard CLAUDE.md, "Keeping it simple"
Timer:

What: the database and Redis URL schemas repeated the same four checks
(present, parses, protocol, hostname). Second use → `connectionUrl()`,
with a callback for each caller's own checks (database name; Redis db 0
and no query string).

Why (what breaks without it): two copies drift; a fix lands in one.

One failure story:

Alternative / why not just…: extract on the first use? You guess the
shape before you know the second caller.

Scryguard link: `packages/config/src/fields.ts`

Interview question I can now answer:

Later:

## ioredis reads options from the URL query string

Depth: supporting
Source: ioredis README, "Connect to Redis" (URL format)
Timer:

What: `redis://host/0?enableOfflineQueue=true` would override the client
option I set in code. So config refuses any query string or fragment,
and any database other than 0.

Why (what breaks without it): an env var change silently turns the
offline queue back on → commands wait instead of failing (breaks
invariant 9).

One failure story:

Alternative / why not just…:

Scryguard link: `packages/config/src/redis.ts`

Interview question I can now answer:

Later:

---

# Part 4: PostgreSQL pool

## Three timeouts, three different failures

Depth: core
Source: node-postgres docs, "Pool" (`connectionTimeoutMillis`) and
"Client" (`statement_timeout`, `query_timeout`)
Timer:

What:

```
waiting for a free connection   → connectionTimeoutMillis (5 s)  "timeout exceeded when trying to connect"
query runs too long on server   → statement_timeout (15 s)       server cancels, code 57014
network stalls, server silent   → query_timeout (17 s)           client gives up
```

`query_timeout` = statement timeout + 2 s margin, so a slow query normally
gets the server's clear 57014 first; the client timer only fires when the
server can't answer at all.

Why (what breaks without it): without `query_timeout`, a stalled network
hangs the request until TCP gives up (minutes). Without
`connectionTimeoutMillis`, a full pool makes callers wait forever.

One failure story (tested with Toxiproxy): every response held → the
query rejects at ~2.5 s with statement timeout 500 ms.

Alternative / why not just…: only `statement_timeout`? The server can't
cancel what it never hears about.

Scryguard link: `packages/database/src/db/pool.ts`,
`test/integration/postgres.integration.test.ts`

Interview question I can now answer: A query hangs in production. Which
timeout fires, and what does the caller see?

Later:

## TCP keep-alive: a switch and a timer

Depth: supporting
Source: node-postgres docs, "Client" (`keepAlive`,
`keepAliveInitialDelayMillis`); Node docs, `socket.setKeepAlive`
Timer:

What: `keepAlive: true` turns the "are you still there?" probes on;
`keepAliveInitialDelayMillis` only sets when they start. I set the delay
and forgot the switch, and pg doesn't complain.

Why (what breaks without it): a router drops an idle connection silently;
the pool thinks it is fine; the next query waits ~17 s on a dead socket.

One failure story: the unit test caught it.

Alternative / why not just…:

Scryguard link: `packages/database/src/db/pool.ts`

Interview question I can now answer:

Later:

Remember: a delay setting does nothing until its on/off switch is set.

## `pool.end()` waits for in-flight queries

Depth: supporting
Source: node-postgres docs, "Pool: pool.end"
Timer:

What: `end()` lets a running query finish, closes every server session,
then refuses new queries. Calling it twice rejects the second call, so
shutdown must call it once (invariant 1).

Why (what breaks without it): if `end()` killed queries, every shutdown
would fail requests that were almost done.

One failure story: a client that is checked out and never released makes
`end()` wait forever. That is why the shutdown deadline exists (P0.8).

Alternative / why not just…:

Scryguard link: `closeDatabase`, P0.7, P0.8

Interview question I can now answer: What happens to an in-flight query
during a deploy?

Later:

## Git does not store empty folders

Depth: breadth
Source: Git FAQ, "Can I add empty directories?"
Timer:

What: `packages/database/migrations/` existed nowhere in git, so a fresh
clone had no folder and `node-pg-migrate` failed with
`ENOENT: scandir 'migrations/'`. Fix: an empty `.gitkeep` inside it.
node-pg-migrate ignores it.

Why (what breaks without it): CI's "Run test migrations" step goes red
even with all the code correct.

One failure story:

Alternative / why not just…:

Scryguard link: `packages/database/migrations/.gitkeep`

Interview question I can now answer:

Later:

---

# Part 5: Redis client

## ioredis's command timeout bounds `QUIT` before my 2 s timer

Depth: core
Source: ioredis README, options `commandTimeout`, `enableOfflineQueue`;
methods `quit` and `disconnect`
Timer:

What: measured with a slow Redis (Toxiproxy latency):

```
close() → quit() → commandTimeout (300 ms) → "Command timed out"
        → my catch → redis_quit_failed → disconnect() → returns at ~300 ms
my 2 s quit timer → never reached
```

The 2 s timer is still a backstop: it covers a `quit()` that never
settles. A unit test proves that path, the integration test proves the
real one.

Also: `disconnect()` ends the socket politely, so on a slow link the
client reaches `end` about 2 s later. It doesn't block `close()`.

Why (what breaks without it): I'd have believed the timer was the thing
protecting shutdown.

One failure story: my first integration test expected `close()` to take
~2 s and failed at 3 ms; a probe showed the real path.

Alternative / why not just…: drop the timer since commandTimeout covers
it? A `quit()` that neither replies nor times out (a bug, a different
setting) would hang shutdown.

Scryguard link: `packages/redis/src/redis.ts`, invariant 9

Interview question I can now answer: How do you make sure closing a
client can't hang shutdown?

Later:

Remember: measure the failure path before trusting the guard you wrote for it.

## One log line per outage

Depth: core
Source: ioredis README, "Events" (`ready`, `error`, `close`, `end`)
Timer:

What: ioredis fires `error` on every reconnect attempt. A small state
(connected / disconnected / never connected / closing) logs only the
change: one "lost", one "restored" with `downForMs` from the monotonic
clock.

Why (what breaks without it): 10 retries → 10 error lines → alerts and
noise for one outage.

One failure story: tested: 4.5 s of real retries against a closed port →
exactly 1 warning.

Alternative / why not just…: rate-limit the log line? Still says nothing
about when it came back.

Scryguard link: `packages/redis/src/redis.ts`, invariant 9

Interview question I can now answer:

Later:

---

# Part 6: Testing

## Test a list by writing the expected list in the test

Depth: supporting
Source:
Timer:

What: `redaction.test.ts` has its own copy of the names it expects to be
hidden, instead of looping over the code's `SENSITIVE_FIELD_NAMES`.

Why (what breaks without it): if the test reads the code's list,
deleting a name from the code deletes it from the test too, and the test
still passes.

One failure story:

Alternative / why not just…:

Scryguard link: `packages/logger/src/redaction.test.ts`

Interview question I can now answer: How do you know a test can fail?

Later:

## Mock implementations leak between tests

Depth: supporting
Source: Vitest docs, "Config: clearMocks, restoreMocks"; "mockReset"
Timer:

What: `clearMocks` clears the call history only. A `vi.fn` given
`mockImplementation(() => { throw … })` in one test keeps throwing in
the next. Fix: `mockReset()` in `beforeEach`, then set the default again.

Why (what breaks without it): tests fail or pass depending on their order.

One failure story: one `disconnect` mock that threw broke three later
Redis tests with confusing "warn was called" errors.

Alternative / why not just…:

Scryguard link: `packages/redis/src/redis.test.ts`

Interview question I can now answer:

Later:

## Toxiproxy: pick the toxic that matches the failure

Depth: supporting
Source: Toxiproxy README, "Toxics" (`latency`, `timeout`)
Timer:

What:
- `latency`: every response is late → tests command and query timeouts.
- `timeout` with `0`: drops data; to ioredis it looked like a closed
  connection (`quit` failed in 2 ms), not a slow one.
- `POST /reset` between tests removes all toxics.

Why (what breaks without it): the wrong toxic tests a different failure
than the one in the test name.

One failure story: see the `QUIT` section above.

Alternative / why not just…:

Scryguard link: `packages/*/test/support/toxiproxy.ts`

Interview question I can now answer:

Later:

## Small tool trap: `pnpm clean` is a pnpm command

Depth: breadth
Source:
Timer:

What: `pnpm --filter @scryguard/logger clean` ran pnpm's own `clean`
command and failed. `pnpm --filter … run clean` runs the package script.
The root `clean` script already uses `pnpm -r run clean`.

Why (what breaks without it):

One failure story:

Alternative / why not just…:

Scryguard link: root `package.json`

Interview question I can now answer:

Later:
