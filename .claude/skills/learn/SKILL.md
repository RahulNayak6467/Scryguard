---
name: learn
description: Start the next Scryguard step problem-first, with the theory it needs and a build checklist, before the user writes code.
argument-hint: "[optional: scope ID or topic]"
disable-model-invocation: true
---

Start the next step. Step: $ARGUMENTS (if empty, the "Next step" in
`docs/private/plan.md` → Now).

# Prepare (silently)

Read `docs/private/plan.md` (Now, the phase row, deferred items for this
phase), the scope IDs involved in `docs/private/scope.md` (spec, tier,
done-when), the phase file `docs/private/phases/phase-N.md`, the ADRs the
step touches, and the code it builds on. Don't pull in later phases (one
line at most).

If `docs/private/phases/phase-N.md` doesn't exist, stop and ask the user to
run `/phase` first. Work from the phase file's task, design questions and
done-when; don't redo its planning.

# Label

State the scope IDs, tier (Core / Solid / Glue), mode (learn / ship) and an
hour estimate that fits the phase budget. The user confirms or changes it.
A Glue step in ship mode skips straight to building; explain only what the
user must be able to say about it.

# Explain (phone-readable, short paragraphs)

1. **What and why:** what this adds and the problem it solves, 2–3 sentences.
2. **What breaks without it:** one concrete failure, told with Scryguard's
   own flow.
3. **The naive version and its trap:** how most people write it first, and
   how that fails in production.
4. **Theory first:** the rows of the phase file's 2a (project theory) and
   2b (case studies) whose Before is this step: the concepts the step needs,
   its failure cases and its scaling limits. Each with the resource,
   sections, what to get from it and minutes; count it as theory hours.
   Add a resource only if one is missing, and verify it. If the user has no
   notes for these in `docs/private/notes/`, give the list and **stop**.
   When the notes are in, review them against the stop rule, push once on
   gaps, then continue.
5. **Interview extras (off the clock):** the phase file's 2c rows that sit
   next to this step's concepts, plus any the step itself raises, as a short
   list. Not counted in project hours, and the step doesn't wait for them.
6. **Prior art (Core only):** one or two lines on how GitHub Actions,
   CodeRabbit, Copilot code review, Semgrep, or SQS and ECS themselves
   handle it, and where Scryguard should differ.
7. **Design questions:** 2–4 questions on shared state, races, failures,
   staleness, untrusted input and errors. Each one is a concrete situation
   in Scryguard's own flow ("SIGTERM arrives while a phone has sent half a
   webhook: what does `server.close()` do?"), never an abstract "how do
   you handle X?". For Core, ask the user to list the failure cases and
   named races before coding.

Do not give the implementation.

# When the user doesn't understand a question

On "didn't understand", "simpler", "example" or "hint", go one level down
without giving the answer: restate it as one idea in one sentence → add an
everyday picture → point to the line or function to look at → last,
split it into two easier questions. Stop at the first level that works.

# Design page (Core and Solid; Glue skips)

After the design answers are sound, the user writes a design page before
any code, in `docs/private/notes/phase-N-<task>-design.md` (theirs; read
it, never edit it). Its time counts toward the task's build hours.

- **Core** (~20–30 min): Problem (the failure story) · Must hold (the
  guarantees, which become test assertions) · Failure cases (each with its
  expected result) · Options (the obvious one and why not; the chosen one)
  · Flow (steps and arrows) · Numbers (limits, formulas, config rules) ·
  Interfaces (names, config fields, log events, error codes) · Tests (one
  per failure case) · Open questions.
- **Solid** (~10 min): Problem · Must hold · Failure cases · Flow.

Review it: push once on gaps (a missing failure case, a flow step with no
failure path, an unconsidered option). Don't rewrite it for them.

# Build checklist

Derive it from the design page, in this order: config and names (no
logic) → the happy path from the Flow → each failure case one at a time,
each with its test (the user names the cases, the `tester` agent writes
them and proves they fail). Done when every failure case on the page has
a passing test that can fail. An Option with a real alternative is
flagged for an ADR at `/wrap`. End with the definition of done for this
step.
