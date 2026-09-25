# Workflow — brainstorm, build, check

No `paths` field, so this loads in every session. It is enforced three ways: this rule, the
`UserPromptSubmit` hook (`.claude/hooks/brainstorm-gate.py`) that reminds Claude on any
build-shaped prompt, and the check hooks that run after every edit and before Claude stops.

## 1. Brainstorm before building — always

Before creating or editing any product file (`*.html`, `*.css`, anything that ships), run a
brainstorm with the user and wait for their go-ahead. Use the `/brainstorm` skill; its output is:

1. **Goal** restated in one or two sentences, plus what "done" looks like.
2. **Options** — two to four real approaches, each with its trade-off. Include "do nothing /
   smaller version" when it is a real option.
3. **Risks and hidden assumptions** — especially the ones this repo has been bitten by:
   the < 900px tab bar, the tool count in four files, `TOOL_FIELDS`, nested
   `updateActiveItem`, icon symbols missing from a page's sprite, invented social proof.
4. **Recommendation** — one option and why.
5. **Plan** — the files that will change and how it will be checked.
6. **Question** — end the turn and ask the user to confirm or redirect. Do not start building
   in the same turn.

Exempt, no brainstorm needed: answering questions, reading or explaining code, a typo or
one-line fix the user specified exactly, and work whose brainstorm already happened and was
approved earlier in the conversation. The user can also say "skip the brainstorm".

If a brainstorm turns up a bigger problem than the request (a bug, a conflict with a rule
here), say so in the brainstorm rather than silently widening the build.

## 2. Build in small, checkable steps

- One concern per edit. After each edit the `PostToolUse` hook runs
  `node tests/check.mjs --static` on the file. If it prints `✗` lines, fix them before the
  next edit: that output is feedback on your change, not noise.
- Pre-existing problems live in `tests/known-issues.txt` and print as `⚠ known`. **Never add a
  line there to get your own change green.** Remove a line when you fix its bug.

## 3. Check before saying it is done

- Run `node tests/check.mjs` (full: every page in real Chromium at 1280px and 390px, every
  toolkit panel, the gate, console errors, 404s, horizontal scroll). The `Stop` hook runs it
  anyway whenever site files are uncommitted, and will not let the turn end while it fails.
- **Look at the screenshots** in `.checks/` for the pages you changed (open the PNGs with the
  Read tool). The script checks what can be asserted; the screenshot is how layout, spacing
  and hierarchy get reviewed. Say what you looked at.
- For behaviour the script does not cover (a calculator's numbers, a copy button), exercise
  it with Playwright or state plainly that it was not verified.
- If a check reveals a bug outside the task, report it; add it to `known-issues.txt` only
  with the user's agreement.

## 4. Keep the docs true

When a change invalidates something in `CLAUDE.md` or `.claude/rules/*.md`, update that file in
the same commit. A rule that no longer matches the code is worse than no rule.
