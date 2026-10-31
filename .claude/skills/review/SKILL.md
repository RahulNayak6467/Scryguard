---
name: review
description: Review the user's Scryguard code. Edge-case questions first so the user finds the bugs, then at most two important findings at a time.
argument-hint: "[optional: files | next | fresh]"
disable-model-invocation: true
---

Review the user's code. Argument: $ARGUMENTS

- **(empty or files):** review that scope; default `git diff main...HEAD`
  plus uncommitted changes.
- **next:** show the next open findings from the plan's Review section; no
  new review.
- **fresh:** delegate to the `reviewer` agent (phase end), then present its
  findings with the rules below.

# Prepare (silently)

Read the code in scope plus its callers and dependencies (migrations, Lua
scripts, middleware, the SQS consumer, the outbox publisher, the sandbox
launcher, the agent graph), the scope IDs, tiers and done-when in
`docs/private/scope.md`, and the ADRs it touches. Run the five questions
over every operation that changes shared state or calls a dependency, at
each gap between steps:

- **evil:** hostile repo content, prompt injection in code, PR text or
  logs, malformed model output, a malicious package name.
- **twice:** duplicate webhooks, redelivered SQS messages, two workers on
  one run.
- **halfway:** a crash or lost reply between steps (verdict saved but not
  published, sandbox started but never stopped).
- **down:** model server, GitHub, SQS, Redis, PostgreSQL or the sandbox
  slow or unavailable.
- **later:** a new head SHA, token expiry, visibility timeout expiry,
  index staleness, data growth.

Keep only cases you can tie to a line and a concrete sequence.

# Round 1: questions (Core and Solid only)

List 3–6 edge cases as questions, most severe first, no answers:

```
1. [twice] SQS delivers the same review message to two workers: what does your code do?
```

Take them one at a time. The user walks through their code; if stuck, give
the next rung only (sharper question → principle → pattern in words). When
they propose a fix, push on the next case it creates. Cases they find count
as theirs.

# Round 2: findings

Then report what the questions didn't surface:

- At most **2 important issues**, in the What / Breaks when / Principle /
  Your move format from `CLAUDE.md`. For a new concept, let the user try
  "Your move" before showing the fixed shape.
- All small fixes, one line each, including over-abstraction against
  `CLAUDE.md` → Keeping it simple.
- The honest tier the code reaches vs its target.

Write remaining important issues to the plan's Review section so `next` can
show them; remove them when fixed. Skip what lint or typecheck catches.
Never pad a clean result. Never write fixes into learn-mode code.
