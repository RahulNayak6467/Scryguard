# 0004. Modular monolith in a monorepo

Status: Accepted · 2026-10-31

## Context

Scryguard has distinct workloads: receiving webhooks and serving the API,
running long reviews, publishing results to GitHub, and serving a
dashboard. They share one data model and rely on transactions that span
review state and the outbox. The system is developed and operated by a
small team.

## Decision

One pnpm workspace, deployed as several processes from the same codebase.

```
apps/       api, worker, publisher, dashboard
packages/   config, logger, database, redis, shared, github,
            agents, retrieval, sandbox
```

- Apps import packages and never each other. Packages never import apps,
  and there are no cycles.
- All processes use the same PostgreSQL database.
- Two components run separately for reasons other than load: the sandbox,
  for isolation (ADR 0005), and the model server, which runs on GPU
  hardware (ADR 0008).

## Consequences

- The verdict and its outbox row commit in one transaction.
- Workers scale independently of the API, and a slow review never blocks
  webhook intake.
- One build, one test setup and one set of shared types.
- Module boundaries are enforced by convention and lint rules, not by
  network boundaries, so they need discipline to stay clean.

## Alternatives considered

- **Microservices with separate databases.** Independent deployment, but
  cross-service consistency would need sagas or distributed coordination,
  and every call adds a network failure mode, with no benefit at this team
  size.
- **A single process.** Simplest to run, but long reviews would compete
  with webhook handling and the API for the same event loop.
