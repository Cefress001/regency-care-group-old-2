---
name: brainstorm
description: Structured brainstorm to run before building or changing anything in this repo — goal, options with trade-offs, risks, recommendation, plan, then stop and ask the user to confirm. Use whenever the user asks to build, add, redesign, refactor or ship something, before editing any product file.
---

# Brainstorm

The project rule (`.claude/rules/workflow.md`) is: no product file changes until a brainstorm
has been confirmed by the user. This skill produces that brainstorm.

## Before writing it

Read enough to be concrete: the relevant part of `toolkit.html` / `index.html`, the matching
`.claude/rules/*.md`, and `tests/known-issues.txt`. A brainstorm that doesn't name real
functions, files or constraints is only guessing.

## Output (in this order, tight)

**BLUF** — one line: what you recommend and the question you need answered.

**1. Goal** — the user's intent in their terms, and what "done" looks like (observable).

**2. Options** — 2–4, as a table:

| Option | What it is | Upside | Cost / risk | Effort |
| --- | --- | --- | --- | --- |

Include a smaller/"don't build it" option when it is genuinely viable.

**3. Risks & hidden assumptions** — what could make this wrong. Check against this repo's known
traps: the < 900px bottom tab bar; tool count in four files (and whether this even counts —
business tools, playbooks, AI layer and My Items do not); `TOOL_FIELDS` persistence;
nested `updateActiveItem`; icons missing from a page's sprite; `ai-*` vs `aix-*` ids; the
three styling worlds (a `styles.css` token doesn't reach checkout or legal pages); no invented
social proof; live Stripe.

**4. Recommendation** — pick one and say why.

**5. Plan** — files to touch, in order, and how each step will be verified
(`node tests/check.mjs`, which screenshots to review, what needs a manual/Playwright test).

**6. Open questions** — only the ones whose answer changes the build. Prefer the
AskUserQuestion tool when there are discrete choices.

Then **stop**. Do not edit product files in the same turn. Build after the user confirms.
