#!/bin/bash
# UserPromptSubmit: append the prompt to docs/prompt-log.md (secrets redacted)
# and remind Claude to keep CLAUDE.md current.
set -euo pipefail
root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
log="$root/docs/prompt-log.md"
mkdir -p "$root/docs"
[ -f "$log" ] || printf '# Prompt log\n\nEvery prompt given to Claude in this project, newest last. Secrets are redacted automatically.\n' > "$log"

prompt=$(jq -r '.prompt // empty' | sed -E \
  -e 's#(postgres(ql)?|mysql|mongodb(\+srv)?)://[^[:space:]"]+#[REDACTED_DB_URL]#g' \
  -e 's#npg_[A-Za-z0-9]+#[REDACTED]#g' \
  -e 's#sk-[A-Za-z0-9_-]{16,}#[REDACTED_KEY]#g' \
  -e 's#(ghp|gho|github_pat)_[A-Za-z0-9_]+#[REDACTED_TOKEN]#g' \
  -e 's#AIza[0-9A-Za-z_-]{30,}#[REDACTED_KEY]#g' \
  -e 's#((password|passwd|pwd|secret|token)[[:space:]]*[:=][[:space:]]*)[^[:space:]]+#\1[REDACTED]#Ig')
[ -z "$prompt" ] && exit 0
# Harness events (background task notices etc.) are not user prompts.
case "$prompt" in "<task-notification>"*|"<system-reminder>"*) exit 0 ;; esac

{
  printf '\n## %s — %s@%s\n\n' "$(date '+%Y-%m-%d %H:%M %Z')" "$(whoami)" "$(scutil --get ComputerName 2>/dev/null || hostname)"
  printf '%s\n' "$prompt" | sed 's/^/> /'
} >> "$log"

jq -n '{hookSpecificOutput: {hookEventName: "UserPromptSubmit", additionalContext: "Project memory rule: if this prompt changes a decision, requirement, status or next step, update CLAUDE.md (and profile/profile.md for applicant facts) before ending the turn. Never store memory outside this repo."}}'
