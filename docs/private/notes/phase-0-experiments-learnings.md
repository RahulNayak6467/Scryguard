# Phase 0 close: factory, experiments and what they taught me

Learned on 2026-11-03, the last session of phase 0. Format: the notes
template, written in plain words. Parts: the factory, the experiments, the
keep-alive bug, small traps.

The earlier shutdown notes (`phase-0-shutdown-learnings.md`) cover
`server.close()`, the deadline, the steps loop and crashes. This file
doesn't repeat them.

---

# Part 1: The factory

## A factory gives every caller its own copy of the state

Depth: core
Source: this session, `createShutdownHandlers`
Timer:

What: a factory is a function you call once with what it needs. It
returns the functions you use. The variables it keeps (`state`, `failed`)
live inside the call, so every call gets fresh ones.

```
createShutdownHandlers(logger, steps, timeoutMs)
  inside:  state, failed
  returns: handleShutdown, handleCrash, install, isDraining
```

Picture a backpack. Each returned function carries the backpack with the
variables of the call that made it. The technical name is a **closure**.

Why (what breaks without it): with `state` at the top of the file, the
whole process shares one copy. Tests had to reload the file
(`vi.resetModules`) before every test to get a clean start.

One failure story: my first version moved the functions inside but left
`state` and `failed` at the top of the file. It "worked", but every call
still shared the same state. A new test ("each call has its own state")
proved it: moving `state` back outside turned 12 tests red.

Alternative / why not just…: "why not a class?" It does the same with
more ceremony; there is nothing to inherit.

Scryguard link: `packages/shared/src/shutdown/shutdown.ts`

Interview question I can now answer: what does a factory function solve
that module-level variables don't?

Later:

## What goes inside, and what can stay outside

Depth: supporting
Source: this session
Timer:

What: size doesn't decide it. A function goes inside if it reads or
changes the private state. A helper that touches no state can stay outside
and take its inputs as arguments.

Inside, the functions don't need `logger, steps, timeoutMs` as arguments
any more. They read the factory's inputs. `handleShutdown(signal)` is
enough.

Why (what breaks without it): if inner functions keep the old arguments,
they hide the factory's inputs, and the factory saves nothing.

One failure story: my second version still passed `logger, steps,
timeoutMs` to every inner function. Removing them shortened every call.

Alternative / why not just…: —

Scryguard link: `cleanupResources()`, `handleShutdown(signal)`

Interview question I can now answer: —

Later:

## Build first, switch on second

Depth: supporting
Source: this session
Timer:

What: the factory only *builds* things. The `process.on(...)` calls live
in a separate `install()` function, and `main.ts` calls it.

Why (what breaks without it): if creating the object added signal
listeners, every unit test would add real listeners to the test runner.

One failure story: the test "installs nothing until install is called"
guards this.

Alternative / why not just…: —

Scryguard link: `shutdownHandler.install()` in `main.ts`

Interview question I can now answer: why should creating an object never
change the process?

Later:

## A function can point at something created later

Depth: supporting
Source: this session, `main.ts`
Timer:

What: in `main.ts` the order looked like a circle:

```
shutdown needs steps
steps need the server
the server needs the app
the app needs readiness
readiness needs shutdown.isDraining
```

The way out: a step's `run` is a function. It reads `server` only when
shutdown actually happens, and by then the server exists. So the steps
can be written first, then the shutdown, then readiness, the app and the
server.

Why (what breaks without it): without that trick, there is no order that
works.

One failure story: `isDraining` used to be imported from `shared`. Once
`state` moved into the factory, that import stopped existing, and
typecheck failed until I reordered `main.ts`.

Alternative / why not just…: —

Scryguard link: `apps/api/src/main.ts`

Interview question I can now answer: —

Later:

---

# Part 2: The five experiments

## Predict first, then break it on purpose

Depth: core
Source: `phase-0.md` §6
Timer:

What: for each experiment I wrote down what would happen and why,
*before* running it. Then we ran it and compared. Two of five predictions
missed, and those two taught me the most.

Toxiproxy is a fake network cable between the API and a database. You can
cut it or make it go silent on command.

```
1 Postgres cut      ✓
2 Redis cut         ✓
3 SIGTERM + slow    ~  right result, wrong time
4 end() hangs       ✗  the deadline never fired
5 bad DATABASE_URL  ✓
```

Why (what breaks without it): without a written prediction, every result
looks "expected" afterwards, and you learn nothing.

Scryguard link: `docs/private/phases/phase-0.md` §6 (measured numbers)

Interview question I can now answer: how do you check that failure
handling really works, not just in tests?

Later:

## Experiment 1: the database is cut

Depth: core
Source: this session
Timer:

What: my prediction was readiness 503 and liveness 200. That was right,
but *how fast* depends on how the cable is cut.

```
A) port closed     → connection refused at once → 503 in 3 ms
B) silent cable    → no reply ever comes        → 503 in 1001 ms
   (the readiness timer, DB_READINESS_TIMEOUT_MS=1000, decides)
```

Liveness stayed 200 the whole time. There was only one log line for
"failed" and one for "recovered", not one per probe. It recovered by
itself when the cable came back.

Why (what breaks without it): a refused connection fails fast; a silent
one waits for your timeout. Without a timeout, case B would hang every
probe.

Scryguard link: `apps/api/src/health/readiness.ts:72`

Interview question I can now answer: what's the difference between a
database that's down and one that's silent?

Later:

## Experiment 2: Redis is cut

Depth: supporting
Source: this session
Timer:

What: my prediction was that readiness stays 200, and it did. The Redis
client logged "connection lost" once, then "restored" once, and
reconnected by itself.

Why (what breaks without it): if readiness checked Redis, a short Redis
blip would mark *every* API instance not ready at once, even though
PostgreSQL, the source of truth, works.

Scryguard link: `createReadinessChecker` (database only)

Interview question I can now answer: what should a readiness check
include?

Later:

## Experiment 3: SIGTERM while a slow request runs

Depth: core
Source: this session
Timer:

What: I needed a request that takes 10 s, but every route answers in
1 ms. The trick: the server can't answer until it has the whole request.
A small script sent a `POST` with a 10-byte body, one byte per second.

My prediction was: the request finishes, exit 0, about 8 s after SIGTERM
(SIGTERM came at 2 s).

What happened:

```
0 s     request starts
2 s     SIGTERM
3 s     new connection → refused   ✓
10 s    last byte → answered       ✓
16.2 s  exit 0                     ✗ 6 s late
```

The extra 6 s is the keep-alive bug. Part 3 explains it.

Scryguard link: `apps/api/test/integration/server.integration.test.ts`

Interview question I can now answer: how do you test that a deploy
doesn't cut off running requests?

Later:

## Experiment 4: closing the database hangs

Depth: core
Source: this session
Timer:

What: my prediction was that the pool's `end()` hangs, so the 20 s
deadline kills the process with exit 1. That was wrong in both runs:

```
idle connection  → pool just hangs up        → exit 0 in 0.01 s
stuck query      → query_timeout gives up at 17 s → exit 0 at 16.8 s
```

The deadline never fired. My config rule forces the shutdown timeout
(20 s) to be longer than the query time limit (15 s) plus a margin. So
the database alone can never reach the deadline.

Why (what breaks without it): the deadline is not the main defense. Each
wait having its own time limit is. The deadline only catches waits with
no limit, like a half-sent request.

Alternative / why not just…: "why not rely on the deadline?" Then every
slow shutdown would end in exit 1, and every deploy would look like a
failure.

Scryguard link: `apps/api/src/config.ts` (shutdown rule)

Interview question I can now answer: what should end a hung shutdown?

Later:

## Experiment 5: a bad `DATABASE_URL`

Depth: supporting
Source: this session
Timer:

What: missing, hostless (`postgres://scry:s3cretFAKE@`) and not-a-URL all
did the same thing: refused to start in under 250 ms with exit 1, and one
`FATAL` line naming the field and the reason. The fake password appeared
nowhere.

Why (what breaks without it): a missing value has nothing to leak. A
*wrong* value can carry the password. The error must describe the
problem, never print the value.

Scryguard link: `loadConfigOrExit`

Interview question I can now answer: how do you report bad config without
leaking secrets?

Later:

---

# Part 3: The keep-alive bug

## Keep-alive held the shutdown open

Depth: core
Source: Node docs, `http.Server` → `keepAliveTimeout`
Timer:

What: keep-alive means "after this response, keep the connection open
for the next request". Even after `server.close()`, Node still answered:

```
Connection: keep-alive
Keep-Alive: timeout=5
```

The connection was busy when `close()` ran, so it wasn't closed. After
the response it sat idle for 5 s, and `server.close()` waited for it.

Why (what breaks without it):
- every shutdown got up to 5 s slower;
- the real danger: keep-alive was allowed up to 120 s, the deadline is
  20 s. A big keep-alive would hit the deadline: exit 1 on every deploy,
  with every config rule passing.

Scryguard link: `apps/api/src/http/app.ts`

Interview question I can now answer: why can keep-alive slow down a
graceful shutdown?

Later:

## The fix, and how the first fix missed a case

Depth: core
Source: this session
Timer:

What: two parts.

1. **While draining, answer `Connection: close`.** The client is told not
   to reuse the connection.
2. **A config rule:** keep-alive must be less than the shutdown timeout.
   The keep-alive maximum dropped from 120 s to 60 s, because 120 s could
   never pass the rule.

One failure story: the first fix checked `isDraining()` when the request
*arrived*. But in experiment 3 the request arrived at 0 s, before
SIGTERM, so draining was false. The rerun still showed 6 s late. A new
test also passed only because its request finished *after* SIGTERM, so it
missed the main case.

The second fix also checks when the response *finishes*. If draining by
then, it ends the connection.

```
before: last byte 10.0 s → exit 16.2 s
after:  last byte 10.0 s → exit 10.2 s (8 s after SIGTERM, as predicted)
```

The new rule also broke two old tests. They used a 5 s shutdown with the
default 5 s keep-alive, and 5 isn't less than 5, so the API refused to
start. The fix was a 1 s keep-alive in those tests. The rule was doing
its job.

Alternative / why not just…: "why not only the config rule?" It stops the
exit 1, but shutdown stays 5 s slow.

Scryguard link: `app.ts` drain middleware; `config.ts` keep-alive rule;
process test "closes the connection of a request that was already running"

Interview question I can now answer: how do you drain keep-alive
connections during shutdown?

Later: handed over (written by Claude). Revisit and be able to rebuild it.

---

# Part 4: Small traps

## An auto-import can start the whole app

Depth: supporting
Source: this session
Timer:

What: the editor added `import { installShutdownHandlers } from
'../main.js'` to the request-id middleware. Importing `main.ts` *runs*
it: config load, pool, server. In tests the env was missing, so it called
`process.exit(1)`, and 6 unit files and 11 process tests failed.

Why (what breaks without it): `main.ts` is the process. Nothing should
ever import it.

Scryguard link: CLAUDE.md "apps import packages, never each other";
`main.ts` owns the process

Interview question I can now answer: —

Later:

## Test your tests

Depth: core
Source: this session
Timer:

What: after writing a test, break the code on purpose and check the test
turns red. Then put the code back.

```
state moved outside the factory → 12 red
Connection: close turned off    → 4 red
finish check turned off         → 1 red (11 s instead of < 3 s)
```

Why (what breaks without it): a test that can't fail proves nothing.

Scryguard link: shutdown, app and process tests

Interview question I can now answer: how do you know a test is useful?

Later:

## A doc line can be half true

Depth: supporting
Source: ADR 0009, `ci.yml:67`
Timer:

What: ADR 0009 said "CI fails on breaking changes to the API". The check
exists, but it only runs on **pull requests**. I commit straight to
`main`, so it had never run. The line now says "CI fails a pull request
that breaks it", and from phase 1 I work through PRs.

Why (what breaks without it): a doc that claims more than the code does
is worse than no doc.

Scryguard link: `docs/adr/0009-error-contract.md`

Interview question I can now answer: —

Later:

## Local-only files don't travel with a clone

Depth: supporting
Source: git docs, `.git` directory
Timer:

What: the private/public commit check lives in `.git/local-pre-commit`.
git never copies `.git/` into a clone, so a fresh clone accepted a mixed
commit. That's by design. On a new machine it has to be installed again
(the step is written in the plan). After `pnpm install` rewrote the git
hook, the check still worked.

Scryguard link: `package.json` `simple-git-hooks`

Interview question I can now answer: —

Later:
