# Phase 0 API: what I learned

Learned while building the API middleware, config, health checks, OpenAPI
and the gitleaks test on 2026-11-02. Format: the notes template, one
section per topic. Parts: debugging, Express, health checks, config,
testing and tooling.

Sources name the official doc sections to read; they are pointers, not
pages I have checked yet.

---

# Part 1: Debugging

## One broken first middleware fails every test

Depth: supporting
Source: this session, request-id middleware
Timer:

What: when many tests fail at once, look for the one thing they all go
through. Here every test app started with the request-ID middleware, and
it threw on every request.

```
request → request-id middleware
            → requireRequestContext(req)   ← context not set yet
            → throws
        → error middleware → 500
49 tests expected 400 / 404 / 413 → all got 500
```

Why (what breaks without it): you fix 49 "different" bugs one by one and
never find the real one.

One failure story: 49 failures turned into 6 after one fix. The 6 left
were the real bugs.

Alternative / why not just…: "why not read the failures top to bottom?"
Read the first error message instead. Here it said "requestContext is
missing", which pointed straight at the cause.

Scryguard link: `apps/api/src/http/request-id.middleware.ts`

Interview question I can now answer: 40 tests fail after one change. How
do you find the cause?

Later:

## A lookup table nobody reads does nothing

Depth: supporting
Source: this session, `BODY_PARSER_ERRORS`
Timer:

What: I wrote a table that maps each body-parser error type to a code,
read `type`, and then never looked it up. Every parser error fell through
to the fallback.

```
entity.parse.failed  → expected INVALID_JSON        → got INVALID_REQUEST_BODY
entity.too.large     → expected 413                 → got 400
```

Why (what breaks without it): clients see one vague code for six
different problems, and a too-large body gets the wrong status.

One failure story: the 413 case showed it best. The parser sends
`status: 413, expose: true`, which matched "any other 4xx" and became a
400.

Alternative / why not just…: "why not let lint catch it?" Lint only
flags unused variables. A table used once somewhere else in the file
looks "used".

Scryguard link: `apps/api/src/http/error.middleware.ts`

Interview question I can now answer: how would you test that every entry
in a mapping table is reachable?

Later:

## `git mv -k` on untracked files "succeeds" and moves nothing

Depth: breadth
Source: this session, moving `http/src` to `src/http`
Timer:

What: `git mv` only moves files Git tracks. `-k` tells it to skip errors
quietly, and it still exits 0. So in `a && b || c && d` the `|| c`
fallback never ran.

Why (what breaks without it): you think the files moved, and the next
step fails with a confusing message ("Directory not empty").

One failure story: `rmdir` failed because all five files were still
there.

Alternative / why not just…: for untracked files, just use `mv`.

Scryguard link: none (shell)

Interview question I can now answer: —

Later:

---

# Part 2: Express

## Express spots an error handler by counting its arguments

Depth: supporting
Source: Express docs, "Error handling", writing error handlers
Timer:

What: Express treats a function as an error handler only if it takes 4
arguments: `(error, req, res, next)`. With 3, it is a normal middleware,
and the error goes past it.

Why (what breaks without it): if you delete the unused `next`, your
error handler silently stops being called.

One failure story: lint flagged `_next` as unused. Deleting it would
have broken the handler. The fix was the lint config:
`argsIgnorePattern: '^_'`.

Alternative / why not just…: "why not a disable comment?" The rule will
hit every error handler. One config line is better than a comment in
each file.

Scryguard link: `eslint.config.js`, `apps/api/src/http/error.middleware.ts`

Interview question I can now answer: why does an Express error handler
need 4 arguments even when `next` is not used?

Later:

## Middleware order: request ID first, error handler last

Depth: core
Source: Express docs, "Using middleware"
Timer:

What: the order in `app.ts` decides what each step can see.

```
nosniff header
request ID        ← first: everything after it reads the context
request logger
body limit        ← before the parser: reject before reading
JSON parser
/health routes
not found
error handler     ← last: only catches errors from steps before it
```

Why (what breaks without it): request ID after the parser → a broken
JSON body gets an error with no request ID. Error handler before the
routes → route errors are never caught.

One failure story: I thought the 49 failures were an order problem. They
weren't: each test builds its own small app with its own order. The
order in `app.ts` is tested separately ("a broken-JSON 400 carries the
request ID").

Alternative / why not just…: "why not set the request ID inside the
error handler?" Then normal log lines for the same request would not
have it.

Scryguard link: `apps/api/src/app.ts`, `apps/api/src/app.test.ts`

Interview question I can now answer: why must the request-ID middleware
run before body parsing?

Later:

## The server picks the request ID, never the client

Depth: core
Source: this session, request-id middleware
Timer:

What: the request ID always comes from `randomUUID()`. A client's
`x-request-id` is checked with a schema and stored next to it as
`clientRequestId`. It is never used as the request ID.

Why (what breaks without it): two clients send `x-request-id: abc`. You
search the logs for `abc` and see two requests mixed together, with no
way to tell which line is which.

One failure story: my first version used the client header as the
request ID.

Alternative / why not just…: "why not trust it if it passes the
schema?" A valid value is still chosen by the client: it can repeat one,
or reuse another request's ID.

Scryguard link: `apps/api/src/http/request-id.middleware.ts`

Interview question I can now answer: should you trust a client's
request ID header?

Later:

## Reject a big body before reading it

Depth: core
Source: body-parser docs, `limit` option
Timer:

What: two checks. The body limit middleware checks the declared
`Content-Length` before anything is read. The JSON parser's `limit`
catches a chunked body, which declares no length.

Why (what breaks without it): a client says it will send 50 MB, and the
server reads and stores all of it before saying no. A few of those at
once and memory runs out.

One failure story: the real-socket test sends a 50 MB header and one
64 KB chunk. The 413 comes back after only that chunk has been read.

Alternative / why not just…: "why not only the parser limit?" It still
reads up to the limit first. The header check costs nothing.

Scryguard link: `apps/api/src/http/helper-error.middleware.ts`,
`apps/api/src/app.test.ts`

Interview question I can now answer: why reject a big body before
parsing it?

Later:

---

# Part 3: Health checks

## Liveness and readiness answer different questions

Depth: core
Source: Kubernetes docs, "Liveness, Readiness, and Startup Probes"
Timer:

What: liveness asks "is the process alive?" and checks nothing else.
Readiness asks "can it serve traffic?" and checks PostgreSQL and
draining. Every readiness failure gives the same public 503 body; the
reason is only logged.

Why (what breaks without it): liveness that checks the database → a
database outage restarts every API copy, and the restarts make it worse.

One failure story: Redis is not in readiness. Redis only speeds things
up, so the API can still answer while it is down.

Alternative / why not just…: "why not show the reason in the 503?" It
tells an outsider which dependency is failing.

Scryguard link: `apps/api/src/health/health.routes.ts`

Interview question I can now answer: liveness vs readiness: why is Redis
not in readiness for Scryguard?

Later:

## Overlapping probes share one query

Depth: core
Source: this session, readiness checker
Timer:

What: if a readiness query is still running, the next probe waits on
the same query instead of starting another. It also logs only when the
state changes: one line when the outage starts, one when it ends.

```
probe 1 ──▶ SELECT 1 (slow) ───────▶ result
probe 2 ──▶ (waits on the same query) ▶ same result
probe 3 ──▶ (waits on the same query) ▶ same result
```

Why (what breaks without it): PostgreSQL is slow, and probes every
second each take a pool connection. Soon the pool is full of health
checks and real requests can't get a connection.

One failure story: a 30-probe outage logs 2 lines, not 30.

Alternative / why not just…: "why not cache the result for 5 s?" The
answer would be up to 5 s old. Sharing only joins a query that is
already running.

Scryguard link: `apps/api/src/health/readiness.ts`

Interview question I can now answer: two readiness probes overlap while
PostgreSQL is slow. What should happen?

Later:

---

# Part 4: Config

## Some rules compare two settings

Depth: supporting
Source: this session, `apps/api/src/config.ts`
Timer:

What: some config rules compare two fields. They run after the schemas
are combined, because spreading `.shape` drops refinements.

```
headers timeout   ≤ request timeout
readiness timeout ≤ statement timeout
shutdown timeout  > statement timeout + 2 s query margin + 2 s Redis quit
                    15 s + 4 s = 19 s  <  20 s ✓
```

Why (what breaks without it): shutdown at 16 s with a 15 s query
running → the deadline kills the process before the query and the Redis
close finish.

One failure story: my own test set the request timeout to 1000 and
forgot the 20000 default header timeout. The rule caught it.

Alternative / why not just…: "why not check at runtime?" Bad config
should stop the process before any connection opens.

Scryguard link: `apps/api/src/config.ts`

Interview question I can now answer: how do you pick a shutdown timeout?

Later:

## Redaction does not cover `config.database.url`

Depth: core
Source: `packages/logger/src/redaction.ts`
Timer:

What: the logger redacts fields named `databaseUrl` or
`connectionString`. The config stores the URL as `database.url`, and
pino does not know that `url` is secret.

Why (what breaks without it): `logger.info({ config })` at startup →
the database password is in the logs.

One failure story: not happened yet. `main.ts` must log a small safe
summary (port, environment, level), never the whole config.

Alternative / why not just…: "why not add `url` to the redaction list?"
It would hide every harmless URL, and `*.url` still only reaches one
level down.

Scryguard link: `main.ts` (to come)

Interview question I can now answer: how do you stop config secrets
from reaching your logs?

Later: write the "config is never logged whole" test with `main.ts`.

---

# Part 5: Testing and tooling

## Prove a test can fail

Depth: supporting
Source: this session, gitleaks test
Timer:

What: after a test passes, break the thing it checks and watch it fail.
I disabled `github-app-token` in `.gitleaks.toml`, exactly that test
went red, and then I put the rule back.

Why (what breaks without it): a test that can't fail proves nothing.
For example, it might filter out every finding and pass forever.

One failure story: the app-token test went red and the other 5 stayed
green, so each test checks its own rule.

Alternative / why not just…: "why not trust a green run?" Green only
says the code and the test agree, not that the test can see a break.

Scryguard link: `tests/secrets/gitleaks.test.ts`

Interview question I can now answer: how do you know your tests would
catch a regression?

Later:

## Build fake secrets at runtime

Depth: supporting
Source: gitleaks README, rules and config
Timer:

What: the test writes `ghp_` + 36 random characters into a temp folder
when it runs. The test file only holds the prefix, so it never looks
like a real token.

Why (what breaks without it): a hardcoded fake token in the test file →
CI's own secret scan fails on it, and you start adding allowlists.

One failure story: avoided. The scan in CI stays clean without an
allowlist.

Alternative / why not just…: "why not an allowlist for the test file?"
An allowlist is a hole: a real secret pasted into that file would pass.

Scryguard link: `tests/secrets/gitleaks.test.ts`, the `gitleaks` service
in `docker-compose.test.yml`

Interview question I can now answer: how do you test your secret
scanner?

Later:

## The OpenAPI test checks the spec against real responses

Depth: supporting
Source: zod-openapi README
Timer:

What: the document is built from the same Zod schemas the routes use.
The test calls each route, and checks that the real body matches the
documented schema exactly, with no extra keys.

Why (what breaks without it): the spec says `{ status }`, but the API
also sends `reason`. Clients build against the spec and break, or learn
internal details.

One failure story: a test that a `not_ready` body with `reason` fails
the strict schema.

Alternative / why not just…: "why not write the spec by hand?" It drifts
from the code the first time someone forgets to update it.

Scryguard link: `apps/api/src/openapi.ts`, `apps/api/openapi.json`

Interview question I can now answer: how do you keep API docs in sync
with the code?

Later:
