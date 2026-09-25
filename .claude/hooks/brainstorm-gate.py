#!/usr/bin/env python3
"""UserPromptSubmit hook: when a prompt asks to build something, remind Claude that
this repo brainstorms first (see .claude/rules/workflow.md). Plain stdout on this
event is added to Claude's context; it never blocks the prompt."""
import json, re, sys

try:
    prompt = json.load(sys.stdin).get("prompt", "")
except Exception:
    sys.exit(0)

p = prompt.lower()
# The user skips the gate explicitly, or is already answering brainstorm questions.
if re.search(r"skip (the )?brainstorm|no brainstorm|brainstorm(ed|ing)? (is )?done|go ahead and build|approved?[,.!]? build", p):
    sys.exit(0)

BUILD = re.compile(
    r"\b(build|add|create|implement|make|develop|design|redesign|refactor|rewrite|"
    r"introduce|ship|set ?up|wire (up|in)|integrate|feature|new (tool|page|section|panel|flow|playbook))\b"
)
if not BUILD.search(p):
    sys.exit(0)

print(
    "BRAINSTORM GATE (project rule, .claude/rules/workflow.md): this prompt looks like a "
    "request to build or change something. Before writing or editing any product file, run "
    "the brainstorm step: restate the goal, list 2-4 options with trade-offs, name risks and "
    "hidden assumptions, give a recommendation, and ask the user to confirm. Build only after "
    "the user confirms (or explicitly says to skip). Exempt: pure questions, typo/one-line "
    "fixes, and work whose brainstorm already happened earlier in this conversation."
)
