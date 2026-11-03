# Phase 1 · Vertical slice

## 1. Goal

The thinnest real path: a PR on the test repo → verified webhook → diff →
one local-model call → a completed Check Run, traceable by delivery ID in
the logs. Naive on purpose (no queue, no table); phases 2–3 make each part
correct. The webhook check is Core; everything else is Solid or Glue.

Budget **30 h (T 6 · B 24)** · deadline **Dec 2**. Starts 6.5 h behind:
the checkpoint (cumulative actual ÷ plan > 1.10 → C2) is hit unless phase
1 closes at **≤ 27.5 h**.

## 2. Theory (6 h)

### 2a. Project theory (4.5 h)

| Topic | Depth | Source | Get from it | h | Before |
|---|---|---|---|---:|---|
| Webhook signatures | core | [GitHub: Validating webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries) (all); [RFC 2104](https://www.rfc-editor.org/rfc/rfc2104) §2 only; [Node crypto](https://nodejs.org/api/crypto.html) `createHmac`, `timingSafeEqual` (read what it does on unequal lengths yourself) | Why HMAC and not a plain hash; why the raw bytes; why constant-time; the `sha256=` prefix | 0.8 | P1.3 |
| Raw body in Express | core | [Express 5: `express.json` `verify`, `express.raw`](https://expressjs.com/en/5x/api/express/) | Two ways to keep the raw bytes, and which one fits `app.ts` today | 0.3 | P1.3 |
| Webhook delivery behaviour | core | [GitHub: Best practices for webhooks](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks) (all); [Handling failed deliveries](https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries) | 10 s limit; no automatic redelivery; `X-GitHub-Delivery` stays the same on redelivery; filter event + action | 0.4 | P1.3 |
| GitHub App auth | core | [Generating a JWT for a GitHub App](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app); [Authenticating as an installation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation); [jwt.io introduction](https://jwt.io/introduction) (structure, signing) | RS256, `exp` ≤ 10 min, `iat` 60 s back; token lasts 1 h; app JWT vs installation token: who each proves you are | 1.2 | P1.5 |
| Permissions | supporting | [Choosing permissions for a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app) | The minimum set for V1.1 and why each is needed | 0.3 | P1.1 |
| Checks API and REST limits | supporting | [Interacting with checks](https://docs.github.com/en/rest/guides/using-the-rest-api-to-interact-with-checks); [Check runs](https://docs.github.com/en/rest/checks/runs) (create, update, `conclusion`); [Get a pull request](https://docs.github.com/en/rest/pulls/pulls) (diff media type); [Rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) (installation limit, secondary limits) | Lifecycle queued → in_progress → completed; which conclusion means what; 5,000/h | 0.6 | P1.9 |
| Ollama and structured output | supporting | [OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility); [Structured outputs](https://docs.ollama.com/capabilities/structured-outputs); [Tool calling](https://docs.ollama.com/capabilities/tool-calling) | `response_format` with a schema; tools yes, `tool_choice` no; why the output is still validated | 0.7 | P1.7 |
| Containers | breadth | [Docker: What is a container?](https://docs.docker.com/get-started/docker-concepts/the-basics/what-is-a-container/) | Container vs VM in two sentences (prepares phase 4) | 0.2 | — |

### 2b. Case studies (1.5 h)

| Case | Problem | What changed | Scryguard takes | h | Before |
|---|---|---|---|---:|---|
| [Stripe: webhooks](https://docs.stripe.com/webhooks) (verify manually, replay attacks, return 2xx fast) | A captured, validly signed request can be replayed | Signed timestamp with a 5 min tolerance | GitHub signs no timestamp, so replay protection is delivery-ID dedup (P2.3); phase 1 states it as a limitation | 0.75 | P1.3 |
| [GitHub: stolen OAuth tokens, April 2022](https://github.blog/news-insights/company-news/security-alert-stolen-oauth-user-tokens/) | Long-lived tokens held by Heroku and Travis CI were stolen and used to clone private repos | Tokens revoked, integrations cut off | Short-lived installation tokens, least privilege, the key outside the repo and out of logs | 0.75 | P1.1 |

### 2c. Interview extras (off the clock)

| Concept | Resource | Be able to say | min |
|---|---|---|---:|
| Length-extension attacks | [Wikipedia](https://en.wikipedia.org/wiki/Length_extension_attack) (Explanation) | Why `sha256(secret + body)` is forgeable and HMAC is not | 15 |
| HS256 vs RS256 | jwt.io (above) | Shared secret vs key pair; why GitHub wants RS256 from apps | 10 |
| Webhooks vs polling | Best practices page (above) | Latency, cost, and what you lose when a delivery is missed | 10 |
| Quantisation | Ollama model pages (pick during P1.7) | Why a 7–8B model fits 8 GB at 4-bit, and what it costs in quality | 15 |

## 3. Tasks (24 h)

| ID | Task | Scope | Tier · mode | h |
|---|---|---|---|---:|
| P1.0 | Owed: `/review fresh` of phase 0 and fixes; revisit the two handed-over pieces | F0 | — | 1 |
| P1.1 | Register the App on the test org (least privilege); key outside the repo; GitHub config validated at startup; tunnel to localhost; Ollama on the GPU PC with its `curl` check | V1.1 | Solid · learn | 1.5 |
| P1.2 | Break first: an unsigned handler gets a tampered body; predict, then run | V1.2 | Core · learn | 0.25 |
| P1.3 | Webhook endpoint: raw body, HMAC check before parsing, 401, event filter, fast ack | V1.2 | Core · learn | 4.5 |
| P1.4 | Fake GitHub API and fake model server (every failure in V1.7) | V1.7 | Glue · ship | 2 |
| P1.5 | Installation token client: RS256 JWT, exchange, reuse until shortly before expiry | V1.3 | Solid · learn | 3.5 |
| P1.6 | GitHub secret and repository-content redaction, plus the secret-shape scrub inside error strings | F0.5, V1.2–V1.4 | Solid · learn | 1.5 |
| P1.7 | Model selection: fixed prompt set, 3 candidates, measure, record | V1.6 | Solid · learn (harness ship) | 2.5 |
| P1.8 | Diff fetch; provider interface; one call with Zod-validated output, timeout, token budget, duration, one retry | V1.4 | Glue · ship | 2.5 |
| P1.9 | Check Run: create in progress, complete with conclusion and summary; failure paths | V1.5 | Solid · learn | 2.5 |
| P1.10 | Wire the flow after the ack; delivery ID on every log line; end-to-end test against the fakes | V1.2–V1.5 | Solid · learn | 1.5 |
| P1.11 | Failure experiments (§6), predicted first | all | Core · learn | 0.75 |
| P1.12 | Exit: real PR on the test repo, time to completed Check Run measured, one delivery traced in the logs | all | — | 0.5 |

Each task notes its estimate and 1.5× stop line before it starts.

**P1.1 App and setup.**
- Which permission would you drop if GitHub showed it was unused, and how would you notice?
- Tunnel for real deliveries (smee or cloudflared): a dev tool only, never shipped. Which, and does it count as a new dependency?
- Done when: the App is installed on the test repo; the API refuses to start without the App ID, key path or webhook secret, naming the field and never its value.

**P1.3 Webhook endpoint.**
- Where is the raw body captured relative to `express.json()` (mounted for every route in `app.ts`)? *(open, from the design notes)*
- The global body limit is 1 MB; GitHub caps payloads at 25 MB. What limit does this route get, and what does GitHub see when it is exceeded?
- A signed payload with an unexpected shape, or an event you ignore: which status, and why does it matter to GitHub's delivery log?
- Done when: tampered body, wrong secret, missing header, wrong prefix and wrong-length signature all return 401 with no handler code run; a valid `pull_request` is acknowledged before any GitHub or model call; the ack time is measured.

**P1.5 Token client.**
- How long to reuse a token, and what happens when it expires mid-request? *(open, from the design notes)*
- Two reviews start at once with an empty cache: how many exchanges happen, and how many should?
- Done when: tests with a fake clock show reuse, refresh before the margin, one exchange for concurrent callers, and a failed exchange is not cached.

**P1.6 Redaction.**
- `logger` stays generic. Where does the secret-shape scrub live: a hook in `logger` with patterns from the app, or in the app?
- Which paths carry the diff, patch and PR body once P1.8 exists?
- Done when: a fake PEM, a `ghs_` token, a webhook secret and a diff never reach a log line, including inside an error message.

**P1.7 Model selection.**
- What makes a prompt set "fixed" enough that the numbers compare across models and later phases?
- Which wins: 98 % schema-valid at 9 s, or 90 % at 3 s? Write the rule before you measure.
- Done when: 3 candidates × the prompt set, each repeated, with schema-valid rate, tool-call validity and p50/p95 latency; the choice and numbers recorded in an ADR; the model pinned by tag and digest.

**P1.9 Check Run.**
- Phase 1 has a summary, not a verdict. Which conclusion does a successful run get, and which does a failed model call get (ADR 0007: never a pass)?
- The Check Run is created, then the model fails. What stops it staying `in_progress` forever, and what still can?
- Done when: the success, model-failed and GitHub-error paths each end with the Check Run completed or a logged reason why it could not be.

**P1.10 Wiring.**
- What does the review flow need from the request once the 202 is sent, and what must it not keep?
- Done when: one end-to-end test runs webhook → Check Run against both fakes; every log line of that delivery carries its delivery ID.

## 4. Data model and migrations

None. The review runs in memory; phase 2 designs the schema.

## 5. Races

| Race | What must hold |
|---|---|
| Two reviews need a token while the cache is empty | One exchange; both get the same token |
| A token is near expiry when a slow review starts; the Check Run update comes after it expires | The token is fetched per GitHub call, not held for the review; a 401 refreshes once |
| `opened` and `synchronize` arrive seconds apart | Each review writes to the Check Run of its own head SHA; neither touches the other |
| GitHub redelivers the same delivery | Known limitation: a second Check Run (fixed by P2.3) |
| SIGTERM arrives after the 202, mid-review | Known limitation: the Check Run stays in progress (fixed in Q3); shutdown still exits on time |
| SIGTERM while a webhook body is still arriving | Cut after the HTTP drain budget; GitHub does not redeliver, so the delivery is lost. Known limitation until a redelivery sweep exists |

## 6. Failure experiments (predict first)

| Break | Expected |
|---|---|
| Tampered body to a handler with no check (P1.2) | It acts on the forged payload |
| Same body with a flipped byte, check on | 401; no GitHub call; the log line holds no secret or body |
| Model server stopped mid-review | Check Run completed as inconclusive within the call timeout |
| Fake model returns invalid JSON twice | One retry, then inconclusive |
| Fake GitHub returns 401 on Check Run update | One token refresh, one retry, then logged; process stays up |
| Wrong private key | Exchange fails 401; the error names the problem, not the key |
| System clock 2 min ahead, no `iat` backdating | GitHub rejects the JWT; measure the skew it tolerates |
| SIGTERM during a review | Exit on time; Check Run left in progress |

## 7. Error codes added

| Kind | Code | Status | Retryable |
|---|---|---|---|
| `unauthenticated` | `INVALID_WEBHOOK_SIGNATURE` | 401 | no |

Brought forward from phase 2 (the phase 0 plan placed `unauthenticated`
there). Missing and wrong signatures share the code.

## 8. Invariants

1. No code reads the parsed payload before the signature is verified.
2. A signature of the wrong length is a 401, never a thrown error.
3. A rejected delivery makes no GitHub or model call.
4. The ack is sent before any outbound call.
5. A token is never used past its expiry minus the margin.
6. At most one token exchange per installation is in flight.
7. Model output reaches a Check Run only after Zod validation; otherwise the run is inconclusive, never `success`.
8. Every outbound call (GitHub, model) has a timeout.
9. No log line holds the private key, a token, the webhook secret, a diff or a PR body.
10. Every log line of a delivery carries its delivery ID.

## 9. Test plan

| Test | Mutation it must catch |
|---|---|
| Valid signature over the raw bytes | Verify over re-serialized JSON → valid deliveries rejected |
| Flipped byte in body | Skip the check → 202 |
| Signature one character short | `timingSafeEqual` without a length guard → 500 |
| Compare uses a constant-time function | Swap for `===` → test spying on the compare fails |
| Ignored event | Treat every event as a PR → a review starts |
| Token reuse with a fake clock | Remove the cache → two exchanges |
| Token refresh at the margin | Margin set to 0 → an expired token is used |
| Concurrent token callers | Remove single-flight → two exchanges |
| Failed exchange then retry | Cache the rejection → second call fails without a request |
| JWT claims | Drop the `iat` backdate → test on claims fails |
| Model invalid JSON twice | Remove the retry or the inconclusive path → `success` or a crash |
| Model timeout | Remove the timeout → test hangs past its limit |
| Check Run on model failure | Default conclusion `success` → test fails |
| Redaction: PEM, `ghs_`, secret, diff, error string | Drop one path or pattern → it appears in output |
| End to end against fakes | Break any link → no completed Check Run |

## 10. Interview questions

1. Walk me through GitHub App auth, from the private key to an API call.
2. Why must the HMAC be computed over the raw body?
3. Why a constant-time compare, and what exactly leaks without it?
4. GitHub waits 10 s and never retries. How do you design for that?
5. How do you cache a token that expires, and what happens on a cold cache under load?
6. How did you choose a local model, and how do you trust its JSON?
7. Your process dies right after the 202. What is lost, and how would you fix it?

## 11. Done when and out of scope

**Done when**
1. A PR on the test repo gets a completed Check Run within about a minute (measured).
2. A tampered webhook is rejected and creates nothing.
3. One delivery is traced end to end through the logs.
4. The model choice and its measurements are recorded in an ADR.
5. Every V1.7 failure is reproducible with the fakes; no test calls a real service.
6. `pnpm validate` green in CI on the phase's PRs.

**Out of scope:** queues, retries beyond the single model retry, any table
(phases 2–3); delivery dedup (P2.3); stale-SHA checks and the outbox (Q3);
a `packages/github` package until a second app uses the code; LangGraph
and specialists (phase 5); the drain delay (phase 10).
