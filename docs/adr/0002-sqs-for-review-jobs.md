# 0002. Amazon SQS for review jobs

Status: Accepted · 2026-10-31

## Context

A review takes from seconds to several minutes: it fetches the repository,
runs tests in a sandbox on two commits and calls several models. It cannot
run inside the webhook request. Workers can crash at any point, GitHub can
redeliver webhooks, and the author can push a new commit while a review is
running. Each head commit must receive exactly one verdict, and that
verdict must be current.

## Decision

Review runs are processed through an SQS standard queue with a dead-letter
queue.

- One message per review run. A run is keyed by repository, pull request
  and head SHA.
- The consumer is idempotent: a run is claimed with a conditional update
  that records an attempt number, and every later write checks it.
- The worker extends the message's visibility timeout while a review is in
  progress. A worker whose attempt has been superseded stops without
  writing.
- The head SHA is checked before the review starts and again before the
  verdict is written. A superseded run is marked stale.
- The verdict and an outbox row are committed in one transaction. A
  separate publisher sends GitHub updates and marks them done.
- After a fixed number of failed receives, a message moves to the DLQ and
  an alarm fires.
- Locally, ElasticMQ provides the SQS API.

## Consequences

- Delivery is at least once, so idempotency and fencing are required, not
  optional. They are tested with redelivery, concurrent consumers and
  killed workers.
- No verdict is published twice and no stale verdict is published.
- Ordering is not relied on; correctness comes from the run key and the
  attempt number.
- Development and tests run without AWS.

## Alternatives considered

- **SQS FIFO.** Its deduplication window is five minutes, so it cannot
  replace an idempotent consumer, and ordering is not needed.
- **BullMQ on Redis.** Simpler to start with, but it would place job state
  in Redis, which is not the source of truth (ADR 0001).
- **Kafka.** There is one job type and no need for replay or multiple
  consumer groups.
- **PostgreSQL as the queue (`FOR UPDATE SKIP LOCKED`).** Viable, but the
  managed queue removes polling load from the database and provides
  visibility timeouts and redrive.
