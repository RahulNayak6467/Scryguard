# Tech stack

A short overview of what Scryguard uses. Exact versions are in
`pnpm-lock.yaml`; the reasoning behind bigger choices is in [docs/adr](adr/).
Update this page in the same PR when you add or remove a dependency.

| Area | Choice | Why |
|---|---|---|
| Runtime | Node.js 24, TypeScript (strict), pnpm workspaces | One language for the API, workers and tooling; one codebase, several processes ([0004](adr/0004-modular-monolith-in-a-monorepo.md)) |
| API | Express 5, Zod | Small and familiar; Zod validates every input and LLM output |
| GitHub | GitHub App; REST through `fetch`, app JWT signed with `node:crypto` | Webhooks, installation tokens, Checks API; token handling kept explicit and easy to fake in tests |
| Database | PostgreSQL 18 + pgvector | Source of truth, plus vector and full-text search in one place ([0001](adr/0001-postgresql-as-source-of-truth.md)) |
| Cache | Redis | Caching, rate limits and live-update fan-out; nothing that can't be lost ([0001](adr/0001-postgresql-as-source-of-truth.md)) |
| Queue | Amazon SQS + DLQ | At-least-once delivery with visibility timeouts and redrive ([0002](adr/0002-sqs-for-review-jobs.md)) |
| Agents | LangGraph.js | Router, parallel specialists and an adjudicator as one graph ([0003](adr/0003-langgraph-js-for-agent-orchestration.md)); findings need evidence ([0007](adr/0007-evidence-required-findings.md)) |
| Models | Open-weight models served by Ollama on a local GPU | No per-token cost; OpenAI-compatible API, so a hosted model can be swapped in for comparison ([0008](adr/0008-local-models-by-default.md)) |
| Embeddings | Local embedding model, same server | Code index without per-call cost |
| Code analysis | tree-sitter, Semgrep, `parse-diff` | Symbol tables, rule-based checks, diff parsing |
| Sandbox | Docker locally, ECS Fargate on AWS | Repository code runs isolated, with no permissions and no internet ([0005](adr/0005-fargate-sandbox-with-vpc-endpoints.md)) |
| Auth | GitHub OAuth, CASL, hashed API keys | Dashboard login, roles, and installation-scoped keys for API access |
| Evals | promptfoo, Python scripts | Eval runs; dataset building and analysis in `tools/python/` |
| Dashboard | Next.js, Tailwind, shadcn/ui, TanStack Query | Trust reports, run timeline, eval results |
| Testing | Vitest, Supertest, Testcontainers, Toxiproxy, k6 | Unit, integration against real services, injected latency and outages, load |
| Infra | Terraform, GitHub Actions (OIDC), Dependabot, gitleaks | Reproducible AWS setup; no long-lived keys in CI; dependency updates and secret scanning |
| AWS | EC2, RDS, SQS, S3, ECR, ECS Fargate, SSM, CloudWatch | One app host; Fargate only for sandboxes; the model server stays on the GPU machine ([0006](adr/0006-lean-aws-footprint.md)) |
| Observability | Pino, Prometheus, Grafana | Structured logs and metrics |

## Not used

Pinecone (pgvector is enough), ripgrep (Postgres full-text search covers
it), BullMQ (we wanted SQS's delivery model), Kafka, Kubernetes, an ORM,
LangChain, and an ALB/NAT gateway/ElastiCache (not worth the cost for one
host).
