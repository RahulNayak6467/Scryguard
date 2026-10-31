# 0003. LangGraph.js for agent orchestration

Status: Accepted · 2026-10-31

## Context

A review runs several specialists, each focused on one failure mode of
AI-written pull requests, followed by an adjudicator that decides which
findings stand. Specialists run in parallel and have individual token and
time budgets. Every step must be recorded for the run timeline and for
evaluation. The rest of the system is TypeScript.

## Decision

The review is a LangGraph.js graph:

```
router -> specialists (in parallel) -> adjudicator
```

- The router is rule-based. It classifies the diff (tests, configuration
  or CI, dependencies, source) and selects specialists with their budgets.
- Four specialists: test integrity, guardrail bypass, hallucinated APIs
  and dependencies, intent and completeness.
- The adjudicator applies ADR 0007 and sets the verdict.
- Graph state is typed and validated. Every node records an input summary,
  tokens, duration, prompt version and outcome.
- Model calls go through a small provider interface (ADR 0008).

## Consequences

- Parallel branches, typed state and per-node instrumentation come from the
  framework rather than custom code.
- The graph runs in the same process and language as the worker, with no
  extra service boundary.
- A dependency on LangGraph.js, which trails the Python version in
  features and documentation.
- A deterministic router is predictable and cheap. An LLM-based router can
  be added later and compared against it.

## Alternatives considered

- **LangGraph in Python as a separate service.** The more mature version,
  but it would add a second runtime, a service contract and another
  deployment to the core of the system.
- **A hand-written orchestrator.** Full control, but rebuilds state
  handling, parallel execution and tracing that the framework provides.
- **A single general-purpose reviewer prompt.** Simpler, but produces
  opinions without evidence and is used as the evaluation baseline instead.
