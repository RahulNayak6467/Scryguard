# 0011. Webhook verification over the raw body

Status: Accepted · 2026-11-07

## Context

GitHub signs each webhook with HMAC-SHA256 over the exact bytes it sends
(`X-Hub-Signature-256: sha256=<hex>`). The API mounts `express.json()`
for every route, which turns the body into an object and drops the
bytes; re-serialising that object does not reproduce them (spacing,
`\u` escapes), so a check over `req.body` rejects real deliveries. The
whole body must be read before the signature can be checked, so the body
limit also bounds what an unauthenticated caller can make the API hold.
GitHub waits 10 s for a reply and never retries a failed delivery.

## Decision

- `POST /webhooks/github` is mounted after the global body-limit check
  and before `express.json()`, with route-level `express.raw` (`type:
  'application/json'`, limit `MAX_REQUEST_BODY_BYTES`, 1 MB).
- Order: signature → `X-GitHub-Event` → event filter → `JSON.parse` →
  action check → full Zod schema → reply. Nothing from the request is
  trusted before the signature passes.
- The received and expected signatures are compared as Buffers: byte
  lengths first, then `timingSafeEqual`.
- Statuses: 401 `INVALID_WEBHOOK_SIGNATURE` for every signature failure;
  400 `MISSING_WEBHOOK_EVENT`, `INVALID_JSON` or `INVALID_INPUT`; 413 for
  bodies over the limit; 204 for events and actions not reviewed; 202 for
  `pull_request` `opened`, `synchronize` and `reopened`.
- The reply is sent before any outbound call.

## Consequences

- Real deliveries verify; a changed byte, a wrong secret or a malformed
  signature is a 401, never a 500.
- Ignored events stay green in GitHub's delivery log, so real failures
  stand out.
- A captured, validly signed request can be replayed: GitHub signs no
  timestamp. Deduplication by `X-GitHub-Delivery` closes this later.
- A delivery cut by shutdown mid-body is lost until a redelivery sweep
  exists.
- Measured: a real `pull_request` payload was ~29 KB; local handling ~1 ms.

## Alternatives considered

- **`verify` on the global `express.json()`.** Runs for every JSON
  request, puts webhook logic in a global parser and keeps raw bytes for
  every request.
- **A 25 MB limit (GitHub's cap).** Lets any caller make the API buffer
  25 MB per request before the 401, for events Scryguard never handles.
- **A webhook library (`@octokit/webhooks`).** Same checks, but the failure
  paths and statuses would not be ours to choose and test.
