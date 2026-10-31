# 0008. Local models by default

Status: Accepted · 2026-10-31

## Context

Every review calls several specialists, and evaluation runs each case
several times. With a hosted provider, development and evaluation costs grow
with every run. A GPU with 8 GB of VRAM is available, which fits open-weight
models of roughly 7–8B parameters at 4-bit quantisation.

## Decision

Chat and embedding models run locally, served by Ollama.

- Ollama exposes an OpenAI-compatible API. All calls go through a provider
  interface with a timeout, a token budget and recorded duration.
- The chat model is selected by measurement on a fixed prompt set: tool
  calling and JSON-schema output reliability, then latency.
- Structured output is validated. Invalid output is retried once, then the
  step is recorded as failed.
- One evaluation run uses a hosted model through the same interface, with a
  spending cap, to compare quality and cost.
- On AWS, the application reaches the model server over a private
  connection.

## Consequences

- No per-token cost in development, tests or evaluation.
- Smaller models reason less reliably. The evidence rule (ADR 0007) limits
  the impact, and the hosted comparison measures the gap.
- Context length and throughput are limited by the GPU, so large diffs are
  trimmed before they reach a model.
- The deployed system depends on the model server being reachable.

## Alternatives considered

- **A hosted provider by default.** Stronger models, but cost grows with
  every review and evaluation run.
- **vLLM.** Higher throughput on the same GPU, but more setup; it can
  replace Ollama behind the same interface if throughput becomes the
  limit.
