# 0012. Own GitHub App token client

Status: Accepted · 2026-11-11

## Context

Every GitHub call (diff, Check Run) needs an installation token. Getting
one takes two steps: sign a short-lived App JWT (RS256, `iat`, `exp`,
`iss`) with the App private key, then exchange it at
`POST /app/installations/{id}/access_tokens` for a `ghs_` token that lasts
one hour. `@octokit/auth-app` does both and caches the result.

## Decision

- Build the client in `apps/api/src/github/` on `node:crypto` and `fetch`.
- The JWT signer takes the App ID, the private key as a `KeyObject` and the
  injected `Clock`. The key is read, validated and converted once at
  startup; it never appears in errors or logs.
- Claims: `iat` = now − 60 s (clock drift), `exp` = now + 540 s (under
  GitHub's 10-minute limit), both from a single clock read; `iss` = the App
  ID as a number.
- The exchange validates GitHub's response with Zod. Expiry comes from
  GitHub's `expires_at`, never from an assumed one-hour lifetime; a missing,
  invalid or nearly expired value is an error and nothing is cached.
- Tokens are cached in an in-memory `Map` per process, one entry per
  installation, created by the client's factory. A token is handed out until
  5 minutes before `expires_at`, and every GitHub call asks for it just
  before it runs, so no caller holds one longer than a single request.
- The cache stores the in-flight exchange promise, so concurrent callers for
  one installation share a single exchange; a failed exchange is removed
  from the cache.
- 500s and timeouts are retryable; 401 is not; 429 is retryable after the
  stated wait; 404 means the installation is gone and is final. Retrying is
  the caller's decision.

## Consequences

- Timeouts, retries, error codes and logging follow the same rules as the
  rest of the API, and every failure path is tested against the fake GitHub
  server.
- The fake clock makes expiry and refresh testable without waiting.
- We own the edge cases a library already covers: refresh margin,
  concurrent callers sharing one exchange, not caching a failed exchange,
  and a 404 after the App is uninstalled.
- Each process does its own exchange per installation per hour; with three
  instances that is three exchanges an hour instead of one.
- A token cached before an uninstall keeps failing with 401 until it ages
  out; handling `installation.deleted` comes with the installations table.
- Entries are never evicted; one small entry per installation seen.
- Rotating the private key means changing config and restarting.

## Alternatives considered

- **`@octokit/auth-app`.** Less code, but its caching, retry and error
  shapes are not ours to choose, and the failure paths would be tested
  through a library's behaviour rather than our own.
- **A shared cache in Redis.** One exchange per installation instead of one
  per process, but sharing an in-flight exchange across processes needs a
  distributed lock with its own expiry, live tokens would sit in another
  system, and token fetching would gain a dependency that can be slow or
  down. Saving a few requests an hour is not worth that.
- **A general JWT library (`jose`, `jsonwebtoken`).** Signing one fixed
  RS256 token is a few lines on `node:crypto`; a dependency adds supply-chain
  surface for no new behaviour.
