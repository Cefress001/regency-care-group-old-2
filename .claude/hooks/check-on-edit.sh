#!/usr/bin/env bash
# PostToolUse hook (Edit|Write): run the fast static checks on the file just edited.
# Exit 2 sends stderr back to Claude as feedback so it fixes the problem immediately.
input=$(cat)
file=$(printf '%s' "$input" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("file_path",""))' 2>/dev/null)
case "$file" in
  *.html|*.css|*.js|*.mjs) ;;
  *) exit 0 ;;
esac
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
case "$file" in *.html) target=$(basename "$file") ;; *) target="" ;; esac
if ! out=$(node tests/check.mjs --static $target 2>&1); then
  printf 'Static check failed after editing %s:\n%s\n' "$file" "$out" >&2
  exit 2
fi
exit 0
