# Phase 0 shutdown: what I learned

Learned while building graceful shutdown for the API, worker and publisher
on 2026-11-02 and 2026-11-03. Format: the notes template, one section per
topic. Parts: how shutdown works, crashes, code shape, testing, tooling.

Sources name the official doc sections to read; they are pointers, not
pages I have checked yet.

---

# Part 1: How shutdown works

## `server.close()` locks the door, it doesn't empty the room

Depth: core
Source: Node docs, `http.Server` → `server.close()`, `closeIdleConnections()`, `closeAllConnections()`
Timer:

What: `server.close()` stops new connections. Idle keep-alive connections
close (Node 19+). Busy connections stay open, and the request on them
finishes. The callback runs only when the last connection ends.

```
server.close()
  ├─ new TCP connections        → refused
  ├─ idle keep-alive connections → closed
  └─ busy connections           → stay; can still carry another request
```

Why (what breaks without it): a client that keeps its connection busy
can hold the shutdown open forever.

One failure story: in my test, a half-sent request (headers with no blank
line) kept `server.close()` waiting until the deadline killed the process.

Alternative / why not just…: "why not `closeAllConnections()` straight
away?" It cuts requests that are still running. Use it only at the
deadline.

Scryguard link: `apps/api/src/main.ts` (`closeHttpServer`)

Interview question I can now answer: what does `server.close()` do to a
keep-alive connection that is in the middle of a request?

Later: whether Node adds `Connection: close` to responses after `close()`.

## The deadline exists because SIGKILL can't be caught

Depth: core
Source: Docker docs, `docker stop`; Compose `stop_grace_period`
Timer:

What: `docker stop` sends SIGTERM, waits for the grace period, then sends
SIGKILL. My own deadline must fire first, so a stuck shutdown still ends
with a log line and exit 1.

```
SIGTERM ─── shutdown ─── my deadline (20 s) ─── grace (30 s) ─── SIGKILL
                          exit 1 + log line        too late, no log
```

Why (what breaks without it): a hung Redis close → SIGKILL → the process
vanishes with no log saying why.

One failure story: the limits are 15 s query + 2 s query margin + 2 s
Redis quit = 19 s, so 20 s fits. It also has to stay below the grace
period.

Alternative / why not just…: "why not a long deadline, like 60 s?" Docker
kills the process first, and your deadline never fires.

Scryguard link: `config.server.shutdownTimeoutMs`, `docker-compose.yml`
`stop_grace_period`

Interview question I can now answer: walk me through `docker stop` to
exit. What is the order inside the process?

Later: a drain delay (readiness 503, wait, then close) only matters behind
a load balancer. Deferred to phase 10.

## One try/catch per step, with the step's name

Depth: core
Source: this session, `cleanupResources`
Timer:

What: shutdown is a list of `{ name, run }` steps. A loop runs them in
order, with one `try/catch` inside the loop. A failure is logged with
`step: name`, and the loop carries on.

Why (what breaks without it): one big `try` around all three → the
database throws → Redis never closes, and the log can't say which step
failed.

One failure story: the unit test makes `database` reject, then checks
that `redis` still ran and exit code is 1.

Alternative / why not just…: "why not `Promise.allSettled`?" It runs
everything at the same time. The database must not close while the server
is still finishing a request that uses it.

Scryguard link: `packages/shared/src/shutdown/shutdown.ts`

Interview question I can now answer: one close step throws. Do the later
steps still run, and what is the exit code?

Later:

## The exit code only ever moves from 0 to 1

Depth: core
Source: Node docs, `process.exitCode`
Timer:

What: set `process.exitCode = 1` when something fails. Never write 0;
it is already the default.

```
crash        → exitCode = 1
steps all ok → exitCode = failed ? 1 : 0   ← writes 0, crash is lost
```

Why (what breaks without it): Docker sees a clean exit after a crash, so
nobody looks.

One failure story: 2nd time with the same mistake. First line 122
(`exitCode = 0` after success), then line 76 (`failed ? 1 : 0`). Both
reset a status an earlier step had set.

Alternative / why not just…: "why not `process.exit(0)` at the end?"
It ends the process at once, before log lines finish writing.

Scryguard link: `cleanupResources`, `handleCrash`

Interview question I can now answer: why use `process.exitCode` instead of
`process.exit()`?

Later:

---

# Part 2: Crashes

## A crash is a graceful shutdown that reports failure

Depth: core
Source: Node docs, `process` → `'uncaughtException'`, `'unhandledRejection'`
Timer:

What: after an error nobody caught, the app's state is unknown, so stop.
But stop the normal way: log `fatal`, set exit 1, then run the same
shutdown. Many triggers, one shutdown.

```
SIGTERM / SIGINT ───────────────────────▶ handleShutdown
uncaughtException ──▶ handleCrash ──┐          ▲
unhandledRejection ─▶ handleCrash ──┴──────────┘
                     (fatal log, exitCode = 1)
```

Why (what breaks without it): ignoring the crash → the process looks fine
but some promise or connection is stuck, and the bug shows up hours later.

One failure story: a crash during a SIGTERM drain must not start a second
shutdown. The guard returns, and the exit code is still 1.

Alternative / why not just…: "why not `process.exit(1)` right away?"
Running requests are cut off and connections never close.

Scryguard link: `handleCrash`, `installShutdownHandlers`

Interview question I can now answer: what should a service do on an
unhandled promise rejection?

Later:

## The crash value is `unknown`, whatever the type says

Depth: supporting
Source: `@types/node` `process.d.ts`, `UncaughtExceptionListener`
Timer:

What: `uncaughtException` is typed `(error: Error, origin)`, but
`throw 'oops'` arrives as a string. `unhandledRejection` is honestly
`(reason: unknown, promise)`. So my handler takes `unknown`, never looks
inside it, and logs it as `err`; the serializer handles any value.

Why (what breaks without it): `error.message` on a thrown string is
`undefined`, and a value with a throwing getter can crash the handler
itself (Node exits with code 7).

One failure story: the unit test passes the string `'plain text reason'`
and checks it is logged and exit is 1.

Alternative / why not just…: "why not `String(error)` in the message?"
It can throw, and it puts error text into the message, where redaction
can't reach.

Scryguard link: `handleCrash(crash, error: unknown, …)`

Interview question I can now answer: what can `reason` be in an unhandled
rejection?

Later:

## Crash listeners use `on`, not `once`

Depth: supporting
Source: Node docs, `process` events
Timer:

What: with `once`, the listener removes itself after the first crash. A
second crash during shutdown then finds no listener, and Node kills the
process before shutdown finishes.

Why (what breaks without it): crash → shutdown starts → a second error →
instant death → half-closed connections.

One failure story: not happened; avoided by using `process.on`.

Alternative / why not just…: "why not `once` to avoid two shutdowns?" The
state guard already stops a second shutdown.

Scryguard link: `installShutdownHandlers`

Interview question I can now answer: —

Later:

---

# Part 3: Code shape

## A shared module must do nothing when it's imported

Depth: core
Source: this session, `shutdown.ts`
Timer:

What: my four `process.on(...)` lines sat at the top level of
`shutdown.ts`. Every file that imports `@scryguard/shared` would install
them, including the database package, the Redis package and every test.
Now they live inside `installShutdownHandlers()`, which only `main.ts`
calls.

Why (what breaks without it): a test imports `systemClock` and silently
gets crash handlers that call `process.exit`.

One failure story: caught before it ran. The unit test "installs nothing
when the module is only imported" now guards it.

Alternative / why not just…: "why not put the four lines in each
`main.ts`?" That works, but it makes 3 copies of rules that must match.

Scryguard link: `packages/shared/src/shutdown/shutdown.ts`

Interview question I can now answer: why should importing a module never
change global state?

Later:

## Shared code never decides numbers

Depth: supporting
Source: this session, the hard-coded `SHUTDOWN_TIMEOUT_MS`
Timer:

What: `shared` can't import config (it depends on nothing), so I
hard-coded `20_000`. That silently ignored `SHUTDOWN_TIMEOUT_MS`. The fix:
the app reads it from config and passes it in, like `logger` and `steps`.

Why (what breaks without it): someone sets the timeout to 25 s in
production and nothing changes. The config rule checks a value no code
uses.

One failure story: the deadline test set 5 s and the process exited at
20,009 ms.

Alternative / why not just…: "why not read `process.env` in shared?"
Then config validation is skipped, and lint forbids it anyway.

Scryguard link: `installShutdownHandlers(logger, steps, timeoutMs)`

Interview question I can now answer: how do you make a library
configurable without it depending on your config?

Later: three arguments passed through every function → the factory.

## Factory function: pass everything once

Depth: supporting
Source: this session
Timer:

What: a function you call once with what it needs, which returns the
functions you use. The state lives inside it.

```
createShutdown({ logger, steps, timeoutMs })
  → inside: state, failed
  → returns: start shutdown, isDraining
```

Why (what breaks without it): today `state` and `failed` are module-level,
so the whole process shares one copy. Tests have to reload the module
(`vi.resetModules`) to get a fresh one.

One failure story: every new input (the timeout) meant changing four
function signatures.

Alternative / why not just…: "why not a class?" A factory does the same
with less ceremony; there is nothing to inherit.

Scryguard link: next task

Interview question I can now answer: what problem does a factory function
solve over module-level variables?

Later: build it.

---

# Part 4: Testing

## Test the process from outside

Depth: core
Source: Node docs, `child_process.spawn`
Timer:

What: the shutdown tests start the API as a real process, send it SIGTERM
or a crash, then check the log lines and the exit code. They don't import
my code at all.

Why (what breaks without it): importing `main.ts` in a test would install
real signal handlers in the test runner and try to listen on a port.

One failure story: the same 11 tests ran against `server.ts`, then against
`main.ts` after the split, unchanged. Only the file path moved.

Alternative / why not just…: "why not unit tests only?" They can't prove
a real SIGTERM reaches the handler or that the process actually exits.

Scryguard link: `apps/api/test/integration/server.integration.test.ts`,
`test/support/crash-trigger.ts`

Interview question I can now answer: how do you test graceful shutdown?

Later:

## A race test must make the race happen

Depth: core
Source: this session
Timer:

What: "SIGTERM twice, 50 ms apart" passed even with the run-once guard
removed: the first shutdown finished in under 50 ms, so the second signal
never overlapped it. Fix: hold a request open so the first shutdown is
still running when the second signal lands.

Why (what breaks without it): a race test that never races proves nothing
and stays green forever.

One failure story: found by breaking the guard on purpose and watching
the test stay green.

Alternative / why not just…: "why not a longer gap?" A longer gap makes
the overlap less likely, not more. Control the timing instead of guessing.

Scryguard link: "runs every step once when a second SIGTERM arrives during
the drain"

Interview question I can now answer: how do you test a race reliably?

Later:

---

# Part 5: Tooling

## `.gitignore` can hide files you meant to commit

Depth: supporting
Source: git docs, `gitignore`, `git check-ignore -v`
Timer:

What: the rule `secrets/` (meant for real secrets) also matched
`tests/secrets/`. The gitleaks test was never committed, and CI never ran
it.

Why (what breaks without it): green locally, missing in CI, and nobody
notices.

One failure story: `git ls-files tests` showed only `tsconfig.json`.
`git check-ignore -v tests/secrets/gitleaks.test.ts` named the line.

Alternative / why not just…: "why not weaken the ignore rule?" It protects
real secrets. Renaming the folder (`secret-scan`) is safer.

Scryguard link: `.gitignore:19`, `tests/secret-scan/`

Interview question I can now answer: —

Later: after a commit that adds files, check `git show --stat` lists them.
