# 0001. PostgreSQL as the source of truth

Status: Accepted · 2026-10-31

## Context

Scryguard stores installations, pull requests, review runs, agent steps,
findings and pending GitHub writes. It also indexes repository code for
retrieval: exact identifier lookups and semantic search over function-level
chunks. Review state must stay consistent under concurrent workers, and
retrieval results must never cross installations.

## Decision

PostgreSQL is the only durable store.

- Application state lives in relational tables with foreign keys, unique
  and check constraints. Access is raw parameterised SQL.
- Semantic search uses pgvector with an HNSW index. Exact matches use
  built-in full-text search (`tsvector` with a GIN index). The two result
  lists are merged with reciprocal rank fusion.
- Every code-index query filters by installation and repository inside the
  query itself.
- Redis is used only for data that can be lost or rebuilt: caches, rate
  limits and pub/sub for live updates.

## Consequences

- Review state, findings and the outbox can change in one transaction.
- One store to back up, secure and purge when an installation is removed.
- Query plans, locks and index choices stay visible and testable.
- Vector search capacity is bounded by a single PostgreSQL instance. This
  is adequate for per-repository indexes at the expected scale.
- Changing the embedding model requires re-indexing, because the vector
  column fixes the dimension.

## Alternatives considered

- **A dedicated vector database (Pinecone, Qdrant).** Better at very large
  scale, but adds a second store to keep consistent and purge, and splits
  installation filtering across two systems.
- **ripgrep or a search engine for exact matches.** Postgres full-text
  search covers identifier lookups without another tool in the runtime.
- **An ORM.** Hides the SQL, locking behaviour and plans that the
  concurrency guarantees depend on.
