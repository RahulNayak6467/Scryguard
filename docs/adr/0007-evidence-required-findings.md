# 0007. Findings require evidence

Status: Accepted · 2026-10-31

## Context

Language models produce confident findings that are sometimes wrong. A
reviewer that reports such findings loses its users' trust quickly. AI
coding agents also fail in ways that can be checked mechanically: tests
that disappear between commits, suppressed type errors, imports of symbols
or packages that do not exist.

## Decision

A finding reaches the verdict only if it carries evidence that a reader can
check.

| Specialist | Evidence |
|---|---|
| Test integrity | Test results on base and head; the test-file diff |
| Guardrail bypass | Semgrep matches; configuration and CI diffs; `tsc` output |
| Hallucinated APIs and dependencies | The repository's symbol table; `tsc` output; npm registry metadata |
| Intent and completeness | The pull request text and linked issue compared with the diff; call sites of changed functions |

The adjudicator discards findings without evidence, merges duplicates
across specialists, assigns severity and sets the verdict: pass, needs
review or block. When a check cannot run (a timeout, an unavailable model,
a package that cannot be installed), the result is inconclusive and is
never treated as a pass.

## Consequences

- Precision is the primary quality measure and is evaluated against a
  general single-prompt reviewer as the baseline.
- Some real problems are not reported because they cannot be proven.
  Recall per failure type is measured so these gaps are visible.
- Each specialist is tied to a deterministic source, which makes its
  contribution measurable by removing it in evaluation.
- Every finding in the trust report links to its evidence.

## Alternatives considered

- **Model judgement alone.** Broader coverage, but low precision and no way
  for a reader to verify a claim.
- **Confidence thresholds on model output.** Model confidence is poorly
  calibrated and does not give the reader anything to check.
