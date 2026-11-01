# Phase 0 setup: what I learned

Learned while setting up the repo, the local stack and CI on 2026-10-31.
Format: the notes template, one section per topic. Topics are grouped:
Docker and the local stack, CI and security, packages and TypeScript,
services.

---

# Part 1: Docker and the local stack

## Bind mount vs named volume

Depth: supporting
Source: Docker docs, "Volumes" and "Bind mounts"
Timer:

What: Two kinds of `volumes:` in Compose.

- **Bind mount** (`./path:/in/container`): shows a file from my repo inside
  the container. Used to give ElasticMQ its config file.
- **Named volume** (`name:/in/container`): storage Docker keeps, so data
  survives a restart. Must also be listed under `volumes:` at the bottom.

How to tell them apart: left side is a path (`./…`) → bind mount; a name →
named volume.

| Service | Data survives restart? | Why |
|---|---|---|
| Postgres | Yes (named volume) | The real data |
| RustFS | Yes (named volume) | Sandbox results worth inspecting |
| Redis | No | Cache and counters, rebuildable (ADR 0001) |
| ElasticMQ | No (memory only) | Jobs can be re-sent; Postgres knows what's pending |
| Test stack | No (`tmpfs`) | Every test run starts empty |

Why (what breaks without it): without a named volume, `docker compose down`
wipes the dev database.

One failure story: I add `rustfs_data:/data` but forget to list
`rustfs_data` at the bottom. Compose refuses to start.

Alternative / why not just…: why not a volume for Redis too? Redis holds
only data that can be lost, so persisting it costs disk writes for nothing.

Scryguard link: `docker-compose.yml`, F0.9

Interview question I can now answer: what's the difference between a bind
mount and a volume, and which data in your system survives a restart?

Later: retention periods for RustFS data (CLAUDE.md: stored data has a
documented retention period).

---

## Redis persistence turned off

Depth: supporting
Source: Redis docs, "Persistence"
Timer:

What: Redis has two ways to write to disk: **AOF** (append-only file, logs
every write) and **RDB** (periodic snapshots). Both are off:
`--appendonly no --save ""`.

Why (what breaks without it): nothing breaks. Persistence would protect data
I already agreed can be lost (ADR 0001, ADR 0006), at the cost of disk
writes and slower restarts.

One failure story: after a Redis restart the cache is empty (a few slower
requests) and rate-limit counters start from zero (a short window where
limits reset). Both are acceptable.

Alternative / why not just…: keep AOF like LLMux? LLMux kept budget data in
Redis. Scryguard keeps nothing there that Postgres can't rebuild.

Scryguard link: `docker-compose.yml`, ADR 0001, ADR 0006

Interview question I can now answer: when is it fine for a cache to lose
everything on restart?

Later: `maxmemory-policy noeviction` is decided in P2.8.

---

## Base OS of an image: bookworm vs trixie (collation)

Depth: breadth
Source: Debian releases page; PostgreSQL docs, "Collation Support"
Timer:

What: `bookworm` (Debian 12) and `trixie` (Debian 13) are the Linux system
under PostgreSQL in the image. Postgres and pgvector are the same in both.
Chose trixie: bookworm is past regular security support.

Why (what breaks without it): **collation** is the rule set for sorting text.
Postgres borrows it from glibc, the system's C library, and glibc changes
between Debian versions.

One failure story: start on bookworm, a year later switch to trixie with the
same data volume. Text indexes were sorted with the old rules but are now
searched with the new ones. Lookups silently miss rows; nothing errors. Fix
is `REINDEX`, if I notice.

Alternative / why not just…: switch later? Possible, but only with a
reindex. Choosing before the first data avoids it.

Scryguard link: `docker-compose.yml`, `phase-0.md` Images

Interview question I can now answer: why can upgrading a database's base
image corrupt indexes without an error?

Later: verify RDS supports pgvector 0.8.7 on PostgreSQL 18 before phase 6.

---

## Pinning images by tag and digest

Depth: supporting
Source: Docker docs, "Image digests"
Timer:

What: `redis:8.10.3-alpine@sha256:2109…`. The **tag** is a readable name; the
**digest** is a fingerprint of the exact image content.

Why (what breaks without it): a tag can be moved to a new build. Same tag on
two machines can mean two different images.

One failure story: `pgvector:0.8.7-pg18-bookworm` was rebuilt today with
PostgreSQL 18.6. LLMux's digest for the same tag was already out of date.

Alternative / why not just…: pin only the tag? Readable, but not
reproducible. Tag + digest gives both.

Scryguard link: both Compose files, CLAUDE.md "Pin every external
dependency"

Interview question I can now answer: what's the difference between an image
tag and a digest?

Later:

---

## Init container and `up --wait`

Depth: supporting
Source: Compose docs, "depends_on" conditions
Timer:

What: RustFS can't create its bucket from a config file. A short-lived
second service (`rustfs-init`, the AWS CLI) runs `s3 mb`, then exits. This
pattern is an **init container**.

```
rustfs starts → healthy → rustfs-init: "create bucket" → exits 0
```

Why (what breaks without it): no bucket → every upload fails.

One failure story: `docker compose up --wait` returned exit code 1, because
it saw `rustfs-init` exit and treated that as failure, even with exit code 0.
CI would always fail. Fix: another service waits for it with
`condition: service_completed_successfully`, so Compose knows the exit is
expected.

Alternative / why not just…: let the app create the bucket at startup? On
AWS, Terraform creates buckets; the app should never need that permission.

Scryguard link: both Compose files, F0.9

Interview question I can now answer: how do you run a one-time setup step
in Docker Compose?

Later:

---

## `127.0.0.1` vs `localhost`

Depth: breadth
Source:
Timer:

What: Compose publishes ports on `127.0.0.1` only. URLs use `127.0.0.1`, not
`localhost`.

Why (what breaks without it): on some machines `localhost` resolves to the
IPv6 address `::1` first. Nothing listens there, so the connection fails.

One failure story: `DATABASE_URL=…@localhost:5432` works on one laptop and
fails on another.

Alternative / why not just…: publish on all addresses? Then the database is
reachable from the whole network.

Scryguard link: `.env.example`

Interview question I can now answer:

Later:

---

## Port clashes with other projects

Depth: breadth
Source:
Timer:

What: two Compose projects can't publish the same port. Another project's
Redis held 6379 and its MinIO held 9000, so Scryguard uses 6380 and 9020.

Why (what breaks without it): `port is already allocated`, and the service
doesn't start.

One failure story: dev Redis failed to start while the test stack (port
6411) was fine.

Alternative / why not just…: stop the other project's containers? Works, but
then the two projects can't run together.

Scryguard link: `.env.example`

Interview question I can now answer:

Later:

---

# Part 2: CI and security

## CI checks the newest commit of a push

Depth: supporting
Source: GitHub Actions docs, "Events that trigger workflows" (push)
Timer:

What: CI runs once per push, on the newest commit of that push. It doesn't
run once for every commit inside it.

```
local:  A (config) → B (code) → C (tests, green)
push:   all three at once
CI:     runs once, on C ✓
```

Why (what breaks without it): if CI ran on every commit, a config-only
commit (A, which can't typecheck yet) would show red forever.

One failure story: pushing A alone makes `main` red, and Dependabot PRs fail
for reasons that aren't theirs. So: commit often, push when `validate` is
green.

Alternative / why not just…: add placeholder files so A passes? That's dead
code, deleted again right away.

Scryguard link: `.github/workflows/ci.yml`

Interview question I can now answer: what does CI actually test when you
push five commits at once?

Later: old commits A and B won't build if checked out (`git bisect`).
Normal for a project's first commits.

---

## gitleaks: what it does and how it scans

Depth: supporting
Source: gitleaks README; gitleaks-action README
Timer:

What: **gitleaks** reads files or git history and looks for anything shaped
like a secret. `.gitleaks.toml` is its rule list: the built-in rules plus one
for my own `scg_` keys.

```
commit → gitleaks reads every line
          ↓
   matches a rule? → yes → fail, name file + line
                   → no  → pass
```

**Unlike CI's tests, gitleaks reads every commit in the push**, not only the
newest. A key added in A and deleted in C is still caught, because git
history keeps A forever.

New commits only vs full history:

| | New commits (CI) | Full history (by hand) |
|---|---|---|
| Speed | Fast, constant | Grows with the repo |
| Catches leaks in new code | Yes | Yes |
| Catches old leaks after a rule change | No | Yes |

Run the full scan by hand after changing `.gitleaks.toml` and before going
public: `gitleaks git . --config .gitleaks.toml --redact`

Why (what breaks without it): a pushed secret stays in history even after
deleting it. Bots scan public repos within minutes.

One failure story: P0.2's test contains fake `ghp_` tokens as plain strings.
CI's own gitleaks flags the test file and goes red. Fix: build the fakes at
runtime (`'ghp_' + 'x'.repeat(36)`), not an allowlist.

Alternative / why not just…: allowlist the test folder? Works, but a real
secret in that folder would pass too.

Limit: gitleaks only catches secrets with a recognisable shape. The webhook
secret and API-key pepper have none; `.gitignore` on `.env` protects those.

Scryguard link: `.gitleaks.toml`, `ci.yml`, P0.2

Interview question I can now answer: how do you keep secrets out of git
history, and what can't a scanner catch?

Later: if the repo ever moves to a GitHub organisation, gitleaks-action
needs a free licence key.

---

## Designing the `scg_` key rule

Depth: supporting
Source: gitleaks README, "Configuration"
Timer:

What: a key is `scg_` + `randomBytes(32).toString('base64url')`. The rule:

```
(?:^|[^A-Za-z0-9_-])(scg_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048])(?:[^A-Za-z0-9_-]|$)
secretGroup = 1, entropy = 4.0, keywords = ["scg_"]
```

| Part | Why |
|---|---|
| Prefix `scg_` | Anyone (and any scanner) can recognise the key |
| 43 characters | 32 bytes in base64url |
| Last character from 16 options | 32 bytes = 256 bits, 43 characters hold 258, so the last one carries only 4 bits |
| Edges instead of `\b` | Keys can end in `-` or `_`, where `\b` fails; RE2 has no lookahead |
| `entropy = 4.0` | Placeholders like `scg_AAAA…` score near 0; real keys about 5 |
| `keywords` | Regex runs only on lines that contain `scg_` |

Why (what breaks without it): without a prefix, a key is random text and no
scanner can find it.

One failure story: P2.11 changes the key length; the rule silently stops
matching. Guard: a P2.11 test makes a key with the real generator and checks
gitleaks catches it.

Alternative / why not just…: tighten it more? A scanner should rather report
one extra string than miss a real key. A checksum inside the key (like
GitHub's tokens) is a key-design choice, not a regex change.

Scryguard link: `.gitleaks.toml`, P2.11

Interview question I can now answer: why do API keys have prefixes?

Later: P2.11 test for the key format.

---

## Dependabot and what it can see

Depth: supporting
Source: GitHub docs, "Dependabot version updates"
Timer:

What: a GitHub bot that checks pinned versions weekly and opens a PR when a
newer one exists. Small updates are grouped into one PR; majors come one by
one. Pins make installs identical; Dependabot keeps the pins current.

```
Dependabot (weekly) → "express 5.3.0 → 5.3.1"
   → opens PR → CI runs → green: merge / red: look
```

**It only sees three kinds of lines:**

| Sees | Example |
|---|---|
| `package.json` / lockfile | `"express": "5.3.0"` |
| `uses:` in workflows | `uses: actions/checkout@…` |
| `image:` in Compose files | `image: redis:8.10.3-alpine@…` |

It does **not** see `${POSTGRES_IMAGE}` from a `.env` file, or an image
inside a `run: docker run …` command.

Why (what breaks without it): pinned versions never update on their own.
Security fixes get missed.

One failure story: LLMux kept images in `.env` and ran gitleaks with
`docker run` in CI. Dependabot was blind to all of them; nothing warned
anyone. Fix in Scryguard: images written in the Compose files, gitleaks and
oasdiff called with `uses:`.

Alternative / why not just…: update by hand? Works until it's forgotten.

Ignores in use: `typescript` major (typescript-eslint supports < 6.1),
`@types/node` major (must match Node 24), `ioredis` major (staying on 5).

Scryguard link: `.github/dependabot.yml`

Interview question I can now answer: how do you keep pinned dependencies,
images and CI actions up to date?

Later: remove each ignore when its reason is gone; a permanent ignore turns
into "stuck forever".

---

## Bots: what companies use

Depth: breadth
Source:
Timer:

What: types of bots, by job: dependency updates (Dependabot, Renovate),
vulnerability scanning (Snyk, Trivy), supply chain (Socket.dev), secret
scanning (push protection, gitleaks), code scanning/SAST (CodeQL, Semgrep),
code review (CodeRabbit), coverage (Codecov), licence compliance (FOSSA),
PR workflow (CODEOWNERS, merge queue), releases (release-please),
infra-as-code (Atlantis), performance (Lighthouse CI), ChatOps, incidents
(PagerDuty), and AI coding agents (Copilot agent, Devin, Claude Code).

Why it matters for Scryguard: Scryguard is itself a code review bot, for PRs
written by AI coding agents. It sits next to Dependabot and CodeQL; it
doesn't replace them.

Phase 0 uses only gitleaks and Dependabot, plus three GitHub settings after
the first push: push protection, Dependabot alerts, branch protection.

Scryguard link:

Interview question I can now answer: where does Scryguard fit among the
bots a team already runs?

Later: idea for phase 11: Scryguard reviewing its own PRs (dogfooding).

---

# Part 3: packages and TypeScript

## Package config vs app config

Depth: supporting
Source: Node docs, "Packages: conditional exports"
Timer:

What:

| | Package | App |
|---|---|---|
| `exports` | Yes: others import it | No |
| `.d.ts` files | Yes: dependents typecheck against them | No |
| `dev` / `start` scripts | No | Yes: it's a process |

`exports` has a custom condition: `@scryguard/source` → `src/index.ts`,
default → `dist/`. Dev, tests and typecheck read source (no build step);
`tsconfig.build.json` sets `customConditions: []`, so builds read `dist/`.

Why (what breaks without it): if the condition name in `tsconfig.base.json`
and the packages' `exports` differ, TypeScript can't find the source files.

One failure story: the copied `tsconfig.base.json` still said
`@llmux/source`. Every package import would fail to resolve.

Alternative / why not just…: always build first? Slower dev loop, and stale
`dist/` causes confusing bugs.

Scryguard link: `tsconfig.base.json`, every `package.json`

Interview question I can now answer: how do workspace packages import each
other without a build step?

Later:

---

## Peer dependency for zod in `config`

Depth: breadth
Source: npm docs, "peerDependencies"
Timer:

What: `config` lists `zod` as a **peer dependency**: "use the zod the app
already has", plus a dev dependency for its own tests.

Why (what breaks without it): with its own copy, `config` and the apps could
end up with two zod instances. Schemas from one don't combine cleanly with
the other.

One failure story: I first said zod should be a normal dependency. Wrong:
LLMux's peer dependency was deliberate.

Alternative / why not just…: a normal dependency? Works while the versions
happen to match; the peer makes sharing explicit.

Scryguard link: `packages/config/package.json`

Interview question I can now answer:

Later:

---

## TS18003 "No inputs were found"

Depth: breadth
Source:
Timer:

What: `tsc` fails when a tsconfig's `include` matches no files.

Why: `src/` folders are empty in the config-only commit. Clears as soon as
the first `.ts` file exists.

One failure story: `pnpm typecheck` failed in all 8 workspaces right after
the config commit. Correct configs, missing code.

Alternative / why not just…: placeholder files? Dead code.

Scryguard link: every `tsconfig.json`

Interview question I can now answer:

Later:

---

# Part 4: services

## ElasticMQ, visibility timeout and DLQ

Depth: core (supporting now, core in phase 3)
Source: AWS SQS docs, "Visibility timeout", "Dead-letter queues", "Long
polling"; ElasticMQ README
Timer:

What: **ElasticMQ** speaks the SQS API and runs locally. The API drops a job
in a **queue**; a worker takes it.

```
webhook → API → [review-jobs] → worker
                    ↓ 5 failed receives
              [review-jobs-dlq]
```

| Setting | Meaning |
|---|---|
| `defaultVisibilityTimeout = 30 seconds` | A taken job is hidden from other workers for 30 s. If not deleted in time, it reappears: that's how a crashed worker's job is retried |
| `receiveMessageWait = 20 seconds` | **Long polling**: wait up to 20 s for a job instead of returning "nothing" at once |
| `deadLettersQueue`, `maxReceiveCount = 5` | After 5 receives without finishing, move the job to the **DLQ** so it stops blocking the line |

Why (what breaks without it): without a queue, the API would review inside
the webhook request, and GitHub times out after seconds.

One failure story: a review takes 5 minutes, the visibility timeout is 2
minutes. SQS shows the job again; a second worker reviews the same PR. Fix
in phase 3: heartbeats.

Alternative / why not just…: BullMQ on Redis? ADR 0002 chose SQS's delivery
model.

Scryguard link: `infra/elasticmq/elasticmq.conf`, ADR 0002, Q3

Interview question I can now answer: what happens to an SQS message when
the worker crashes halfway?

Later: phase 3: tune the timeout, add heartbeats.

---

## ElasticMQ queue URLs and `node-address`

Depth: supporting
Source: ElasticMQ README, "node-address"
Timer:

What: SQS clients ask for a queue's **URL**, then send every request there.
ElasticMQ builds that URL from its own port (9324) by default.
`node-address { host = "*" }` makes it use the host and port of each request.

```
test → 9334 (test ElasticMQ): "where is review-jobs?"
     ← "http://localhost:9324/…"  ✗ dev port
test → 9324 (dev ElasticMQ): sends the job
```

Why (what breaks without it): tests send jobs to the dev queue and pass
against the wrong queue.

One failure story: above. Tested the fix: mapped to 9399, ElasticMQ answered
with URLs on 9399.

Alternative / why not just…: a separate config file per stack? Two files to
keep in sync.

Scryguard link: `infra/elasticmq/elasticmq.conf`

Interview question I can now answer:

Later:

---

## RustFS instead of MinIO

Depth: supporting
Source: GitHub `minio/minio` (archived); RustFS README
Timer:

What: **RustFS** speaks the S3 API and runs locally. **S3** stores files
(**objects**) in folders (**buckets**). One bucket: `sandbox-results`. On AWS
it's real S3.

Why (what breaks without it): sandbox results are megabytes, too big for a
queue message. The sandbox writes a file; the worker reads it.

One failure story: MinIO, named in the scope, turned out to be archived
(last release October 2025). Checked before writing any config, swapped
through the change rule.

Alternative / why not just…: SeaweedFS (fallback), Garage (more setup),
S3Mock (too limited), LocalStack (heavy).

Notes:
- Access key + secret key are S3's user name and password.
- Region is required by clients even though RustFS ignores it.
- S3-compatible stores need **path-style** URLs (`host/bucket/file`); the
  phase 4 client needs `forcePathStyle: true` when `S3_ENDPOINT` is set.
- RustFS runs as user 10001, so the test `tmpfs` is given to that user.

Scryguard link: both Compose files, F0.9, X4.7

Interview question I can now answer: how do you test S3 code without AWS?

Later: phase 4: the S3 client.

---

## Redis client must fail fast

Depth: core
Source: ioredis README, "Offline queue", "Auto-reconnect"
Timer:

What: with ioredis defaults, a command sent while Redis is down waits in the
**offline queue** while ioredis reconnects. Fail-fast: `enableOfflineQueue:
false`, `maxRetriesPerRequest: 1`, a `commandTimeout`.

```
request → ioredis → [waiting line] … Redis dead
                        ⏳ 1 s, 2 s, 5 s …
```

Why (what breaks without it): every request that touches the cache hangs;
the whole API slows down because of a cache.

One failure story: Redis stops; every `redis.get` waits for seconds; all
requests pile up.

Alternative / why not just…: keep waiting for Redis? A cache miss costs
1 ms; a wait costs everything.

Also:
- Redis is **not** in readiness: an outage would mark every instance "not
  ready" and stop all traffic, though Postgres is fine.
- `close()` runs once and gives up after 2 s, or `docker stop` kills the
  process mid-shutdown.
- Log once per outage, not once per reconnect attempt.

Scryguard link: F0.4, `phase-0.md` invariant 9

Interview question I can now answer: why is Redis not in your readiness
check?

Later: P2.8 decides whether the app keeps going without Redis.

---

## Ollama on a separate PC

Depth: supporting
Source: Ollama FAQ, "How do I configure Ollama server?"
Timer:

What: Ollama runs on the GPU PC, outside Compose. Scryguard only needs
`OLLAMA_BASE_URL`.

```
Mac (pnpm dev) ──LAN──▶ PC: Ollama :11434 ──▶ GPU
```

| Step | Why |
|---|---|
| `OLLAMA_HOST=0.0.0.0:11434` on the PC | By default Ollama only accepts connections from the PC itself |
| Fixed LAN address (router DHCP reservation) | Otherwise the IP changes and `.env` points at nothing |
| Firewall: port 11434 from the Mac only | Ollama has no password |
| `curl -fsS "$OLLAMA_BASE_URL/api/version"` | Reachability check |

Why (what breaks without it): connection refused from the Mac.

One failure story: works today, stops a week later: the router gave the PC
a new address.

Alternative / why not just…: run Ollama on the Mac? Works, but V1.6 measures
models on the PC's 8 GB GPU.

Scryguard link: `.env.example`, ADR 0008, V1.6

Interview question I can now answer:

Later: set up around 2026-11-07, at the start of phase 1.
