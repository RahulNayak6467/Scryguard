# 0005. Fargate sandbox with no internet access

Status: Accepted · 2026-10-31

## Context

To verify a pull request, Scryguard runs the repository's tests, the type
checker and static analysis on both the base and head commits. That code is
untrusted: it can try to read credentials, contact external hosts, exhaust
resources or tamper with results. It must never run on the worker host or
with access to application secrets.

## Decision

Repository code runs only in a sandbox.

- **Locally:** a Docker container started by the worker through the Docker
  Engine API.
- **On AWS:** one ECS Fargate task per check, started with `RunTask`.
- The task has no IAM permissions of its own, runs as a non-root user, has
  a read-only root filesystem with a writable work directory, and is
  limited in CPU, memory, run time and output size.
- The task runs in a private subnet with no NAT gateway. VPC endpoints for
  ECR, S3 and CloudWatch Logs are its only network routes.
- The worker fetches the repository with the installation token and
  uploads a snapshot to S3. Dependencies are installed beforehand in a
  throwaway container with lifecycle scripts disabled, so no package code
  runs during the install. No credential enters the sandbox.
- Results are written to S3 and validated by the worker. Missing or
  truncated results are recorded as inconclusive, never as a pass.

## Consequences

- Repository code cannot reach the internet, the instance metadata service
  or any application secret.
- Each check runs in its own task with no shared state between reviews.
- Packages that require install scripts cannot be built, and those checks
  are reported as inconclusive.
- Fargate start-up adds latency to each check.
- The same runner interface covers Docker and Fargate, so behaviour can be
  tested locally.

## Alternatives considered

- **Running tools on the worker host.** Untrusted code would share the
  host with credentials and other reviews.
- **A NAT gateway with an egress allowlist.** Allows dependency installs
  inside the sandbox, but adds cost and a network path for exfiltration.
- **gVisor or Firecracker microVMs.** Stronger isolation, but requires
  operating the isolation layer; Fargate provides task-level isolation as
  a managed service.
