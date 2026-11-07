# P1.3 Webhook endpoint design

## Problem
In P1.2, a curl with no signature got a 202 and a log line saying a
review was requested for evil/repo #999. Anyone could make Scryguard
use its own GitHub access (confused deputy), flood the review queue
and use up the GitHub rate limit.

## Must hold
1. No code reads the body before the signature passes.
2. A wrong-length signature is a 401, never a crash (500).
3. A rejected request starts no review and makes no GitHub or model call.
4. The reply goes out before any GitHub or model call.
5. No log line holds the body, the signature or the secret.

## Decisions
- Raw body: express.raw on the webhook route, with
  type 'application/json'. The route sits after the body limit
  (line 50) and before express.json (line 51).
  Not verify on the global parser: it would run on every JSON
  request, put webhook code in a global parser, and keep raw bytes
  for every request.
- Size: 1 MB (MAX_REQUEST_BODY_BYTES). Real PR events are about
  20–60 KB. Not 25 MB: the whole body must be read before the HMAC,
  so a bigger limit lets anyone make us hold more memory.
  Enforced twice: line 50 checks the size the sender claims;
  the express.raw limit checks the bytes that really arrive
  (catches requests with no Content-Length).
- Signature: header X-Hub-Signature-256, must start with sha256=.
  Check the length first, then timingSafeEqual. The early length
  exit leaks nothing, because the length is public
  (sha256= + 64 hex characters).
- Order: signature first, then the event type. Nothing is trusted
  before the signature passes, headers included.
- Event type comes from the X-GitHub-Event header, not the body.
- Status codes: 4xx means the sender must change something;
  5xx means we broke. 204 for ignored events keeps GitHub's log
  green, so real failures stand out in red.

- Order of checks: signature → event
  header → event filter (non
  pull_request → 204) → JSON.parse →
  action check (tiny Zod schema) →
  full Zod schema → 202.
  Event filter before parsing, so ping
  and push never hit a body schema.
  Action check before the full schema,
  so a closed event with odd fields
  gets 204, not 400.
- Actions reviewed: opened, synchronize,
  reopened. Everything else → 204.
- Bad shape uses parseRequest →
  400 INVALID_INPUT with field paths.
  Not INVALID_REQUEST_BODY: the error
  middleware already uses that for
  "body could not be read".

## Failure cases (case → status → what happens)
- Signature missing → 401 INVALID_WEBHOOK_SIGNATURE → no review
- No sha256= prefix → 401, same code → no review
- Wrong length → 401 → no review, no crash
- Wrong secret or changed body → 401 → no review
- Claimed size over 1 MB → 413 (line 50) → no review
- No Content-Length, body over 1 MB → 413 (express.raw) → no review
- Signed, X-GitHub-Event missing → 400 → no review
- Signed PR event with a bad shape → 400 → log delivery ID and the
  failing field, never the body
- Signed, event or action we ignore → 204 → no review
- Signed pull_request we review → 202 → review starts after the reply
- Our code throws → 500

- Signed PR event with a bad shape →
  400 INVALID_INPUT (was
  INVALID_REQUEST_BODY)
- Signed, not valid JSON → 400
  INVALID_JSON (JSON.parse is caught)
- Signed closed event with missing
  fields → 204

## Known limitations
- Same delivery twice: both run, two Check Runs on one commit.
  Fixed in phase 2 by storing delivery IDs.
- Replay of a copied signed request: passes, because GitHub signs no
  timestamp. Fixed in phase 2 the same way.
- SIGTERM while the body is arriving: the drain cuts the connection,
  GitHub sees no status, marks it failed and does not resend.
  Recover with a manual redelivery (kept 3 days).

## Flow
request → body limit (413) → express.raw (413) → signature check
(401) → event header (400) → ignored event? (204) → payload shape
(400) → reply 202 → review work

## Numbers
- 1 MB body limit, in two places
- Signature: sha256= + 64 hex characters
- GitHub waits 10 s for a reply

## Measured
Ack time, local (10 signed curls):
typical ~1 ms, worst ~3 ms, first
(cold) ~9 ms.
Real delivery (PR #1, tunnel on
hotspot): server durationMs 152 ms,
mostly body arrival; local handling
~1 ms. Limit 10,000 ms.
Payload size: ___ KB (from the
delivery's Content-Length).
Re-check in P1.10 when work runs
after the 202.

### Local Curl Setup vs Cloud Flare Tunnel Setup durationMs
Real delivery (PR #1, via tunnel on hotspot):
server durationMs 152 ms. Mostly body
arrival through the tunnel; local
handling ~1 ms. Limit 10,000 ms.


## Interfaces

Route: POST /webhooks/github
  express.raw, type application/json,
  limit MAX_REQUEST_BODY_BYTES (passed in)
  createWebhooksRoutes(webhookSecret, limit)

Headers read:
- X-Hub-Signature-256: sha256= + 64 hex
- X-GitHub-Event: event name
- X-GitHub-Delivery: delivery ID (logs)

Actions reviewed: opened, synchronize,
  reopened. Any other → 204.

Error codes (status · kind · code):
- 401 · unauthenticated (new kind, not
  retryable) · INVALID_WEBHOOK_SIGNATURE
  (missing, no prefix, wrong length,
  wrong secret, changed body)
- 413 · payload_too_large ·
  PAYLOAD_TOO_LARGE (reused)
- 400 · invalid_input ·
  MISSING_WEBHOOK_EVENT (new)
- 400 · invalid_input · INVALID_JSON
  (reused; JSON.parse is caught)
- 400 · invalid_input ·
  INVALID_INPUT (reused; Zod)
- 500 · internal · INTERNAL_ERROR
Rule: one code per distinct fix.

Success: 202 (reviewed), 204 (ignored).

Log: one webhook_received line with
  deliveryId, event, action, outcome.
  Never the body, signature or secret.

Also add this line under Failure cases:
- Signed, not valid JSON → 400
  INVALID_JSON → no review
