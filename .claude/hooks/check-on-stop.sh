#!/usr/bin/env bash
# Stop hook: if site files changed and are uncommitted, run the full browser check before
# Claude may finish. Exit 2 blocks the stop and hands the failures back as feedback.
input=$(cat)
# Already continuing because of this hook — don't loop forever.
if printf '%s' "$input" | grep -q '"stop_hook_active": *true'; then exit 0; fi
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
changed=$(git status --porcelain -- '*.html' '*.css' '*.js' 2>/dev/null)
[ -z "$changed" ] && exit 0
if ! out=$(timeout 240 node tests/check.mjs 2>&1); then
  printf 'Full check failed on uncommitted changes — fix before finishing (screenshots in .checks/):\n%s\n' "$out" >&2
  exit 2
fi
exit 0
