#!/bin/bash
# Stop: commit and push project memory so the other machine sees it.
# Only memory paths are committed; code changes are left for a normal commit.
root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$root" || exit 0
paths=(CLAUDE.md docs profile .claude/hooks .claude/settings.json agent/learnings agent/skills)
existing=()
for p in "${paths[@]}"; do [ -e "$p" ] && existing+=("$p"); done
[ ${#existing[@]} -eq 0 ] && exit 0

git add -- "${existing[@]}" 2>/dev/null
if ! git diff --cached --quiet -- "${existing[@]}"; then
  git commit -q -m "memory: sync from $(scutil --get ComputerName 2>/dev/null || hostname) $(date '+%Y-%m-%d %H:%M')" -- "${existing[@]}"
fi
git remote get-url origin >/dev/null 2>&1 || exit 0
git pull --rebase --autostash -q >/dev/null 2>&1
git push -q >/dev/null 2>&1 || true
