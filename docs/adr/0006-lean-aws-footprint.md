# 0006. Lean AWS footprint

Status: Accepted · 2026-10-31

## Context

Scryguard needs a reproducible production deployment with private
networking for the sandbox, least-privilege IAM and keyless CI deploys. It
runs at low volume, mostly for demonstrations, and the monthly cost should
stay small. The largest cost drivers in a standard setup are a load
balancer, a NAT gateway and managed cache nodes.

## Decision

A minimal deployment, fully defined in Terraform.

| Component | Choice |
|---|---|
| API, worker, publisher, Redis | Containers on one EC2 host; Caddy terminates TLS |
| Database | RDS PostgreSQL, single-AZ, automated backups |
| Queue | SQS with a DLQ |
| Storage | S3 for snapshots, sandbox results, logs and Terraform state |
| Sandbox | ECS Fargate tasks and ECR images (ADR 0005) |
| Secrets | SSM Parameter Store |
| Monitoring | CloudWatch logs, four alarms, and a budget alarm |
| Deploys | GitHub Actions through OIDC; restarts through SSM Run Command |

The stack is destroyed between demonstrations and recreated with
`terraform apply`.

## Consequences

- Running cost is roughly $35–50 a month, and close to zero when the stack
  is destroyed.
- No long-lived AWS credentials exist in CI or on developer machines.
- The EC2 host is a single point of failure for the API and workers. An
  Auto Scaling group behind a load balancer is the next step if
  availability requirements grow.
- Redis on the host loses its data on restart. This is acceptable because
  Redis holds only rebuildable data (ADR 0001).

## Alternatives considered

- **ECS services behind an Application Load Balancer.** More standard and
  more available, but adds a load balancer and service configuration that
  the current load does not need.
- **ElastiCache.** Managed and durable, but costly for data that may be
  lost.
- **Secrets Manager.** Adds rotation features that are not needed for a
  handful of secrets; Parameter Store covers storage and access control.
