#!/bin/bash
# SessionStart: pull the latest project memory from the other machine.
root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$root" || exit 0
git remote get-url origin >/dev/null 2>&1 || exit 0
if out=$(git pull --rebase --autostash -q 2>&1); then
  msg="Pulled latest project memory from GitHub. Last commit: $(git log -1 --format='%h %s (%cr, %an)')"
else
  msg="WARNING: git pull failed, CLAUDE.md may be out of date: $out"
fi
jq -n --arg m "$msg" '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $m}}'
