---
name: phase
description: Draft the detailed plan for a Scryguard phase before it starts, from the fixed template, and write it after the user confirms.
argument-hint: "[optional: phase number]"
disable-model-invocation: true
---

Draft the plan for phase $ARGUMENTS (if empty, the current phase in
`docs/private/plan.md`). Planning time is off the clock.

# Prepare (silently)

Read the phase row and Deferred in `docs/private/plan.md`; every scope ID
of the phase in `docs/private/scope.md` (each spec and done-when must map
to tasks, tests or experiments; nothing outside them gets a task);
`docs/private/design-notes.md` §1–§3 and the phase's section in §4
(intent, decisions, races, break-first, open questions, things to resist,
and any Learned entries); the previous phase file and its weak spots; the
ADRs involved; the code the phase builds on. Never pull in later phases.

# Consistency check (before drafting)

- Compare the design notes with the current code, `scope.md` and the
  ADRs. List every conflict (for example, a note assumes an outbox where an
  ADR chose a sweeper) and ask the user how to resolve it. Never resolve a
  conflict silently.
- Check the interview coverage contract (design notes §3): every concept
  mapped to this phase's IDs must be delivered by at least one task at
  level 3 or above.
- Carry the note's open design questions into the task's design questions
  without answering them.

# Template (`docs/private/phases/phase-N.md`)

1. **Goal:** 2–3 lines: what the phase delivers and why. Budget (T · B) and
   deadline from the plan.
2. **Theory**, in three tables. Verify every link before writing it; mark
   any you couldn't open as "to verify". The hours of 2a and 2b add up to
   the phase's T; 2c is off the clock.
   - **2a. Project theory:** the concepts the phase's code uses (for
     example caching strategies, failure cases, scaling limits). Each topic
     with a depth label (core / supporting / breadth), one specific
     resource (doc section, article, chapter), what to get from it, hours,
     and the task it must come before.
   - **2b. Case studies:** 1–3 engineering blog posts, talks or postmortems
     on how a large company built the same thing: the problem they hit,
     what they changed, and what Scryguard takes from it or does
     differently. Hours and the task it must come before.
   - **2c. Interview extras (off the clock):** concepts next to the phase's
     topics that interviews ask but the code doesn't use (for example MVCC,
     B-tree vs LSM, isolation levels in a PostgreSQL phase). One resource
     each, what to be able to say, and minutes. Not counted in T or B; the
     user reads them outside project time.
3. **Tasks:** table of ID, task, tier · mode, hours (adding up to B, exit
   included). Under the table, per learn task: 2–3 **design questions** and
   one **done-when** line.
4. **Data model and migrations:** tables, indexes, constraints, the
   expand/contract steps. "None" is fine.
5. **Races:** each named, with what must hold.
6. **Failure experiments:** what to break and the expected behaviour. The
   user predicts before running.
7. **Error codes added:** code, status, retryable.
8. **Invariants:** numbered, each testable.
9. **Test plan:** test and the mutation it must catch.
10. **Interview questions:** 5–8 this phase prepares the user for.
11. **Done when** and **out of scope**.

Length by phase size: ≤20 h → ~80–120 lines; 20–35 h → ~120–170; 40 h+ →
~170–220. Tables over prose. No repetition of `CLAUDE.md` rules.

# Confirm

Show the draft (phone-readable summary first: goal, task list with hours,
anything that looks over budget). Ask what to change. Write the file only
after the user confirms, then point the plan's Now → Next step at the first
task.
