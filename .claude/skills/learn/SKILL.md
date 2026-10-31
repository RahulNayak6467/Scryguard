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
   staleness, untrusted input and errors. For Core, ask the user to list
   the failure cases and named races before coding.

Do not give the implementation.

# After the user answers

Check their design answers. Agree when sound; push once on gaps. Then give a
**build checklist**: the pieces to write, in order, and the tests the step
needs (the user names the cases, the `tester` agent writes them). End with
the definition of done for this step.
