# Sana Agent — project memory

**Read this first in every new chat.** This file is the single source of truth for the project.
All memory lives in this repo (this file, `profile/`, `docs/`, `agent/learnings/`), never in
machine-level Claude memory (`~/.claude/...`). When a decision is made or something is built,
update this file in the same turn.

### How memory stays in sync (two users, two machines)
- `.claude/hooks/log-prompt.sh` (UserPromptSubmit): appends every prompt to `docs/prompt-log.md`
  with time, user and machine, **secrets redacted**, and reminds Claude to update this file.
- `.claude/hooks/sync-pull.sh` (SessionStart): `git pull` so a new chat starts from the latest memory.
- `.claude/hooks/sync-push.sh` (Stop, async): commits only memory paths (`CLAUDE.md`, `docs/`,
  `profile/`, `.claude/`, `agent/learnings|skills`) and pushes. Code is committed normally.
- Requires a **private** GitHub remote (`origin`). Without one, logging works but nothing syncs.
- Data (professors, emails, runs) is shared through Neon, not git.

## Goal
Help **Tamanna Zubairi Sana** (the user's girlfriend) get a **fully funded** PhD (preferred) or
masters abroad: tuition + stipend/salary + health insurance. Country does not matter.

An autonomous agent runs overnight on a local Mac and:
1. finds professors and funded positions,
2. researches each one (papers, grants, recruiting signals, fit),
3. scores them,
4. writes a specific, personal outreach email and **sends it from Tamanna's Gmail without approval**,
5. watches the inbox for replies and classifies them,
6. learns from what happened (updates its own playbooks).

In the morning, either user opens the local dashboard and sees what was done.

## Users
- Two dashboard logins: the user (developer) and Tamanna. Create with `pnpm user:create <email> <name> <password>` in `web/`.
- Emails are sent **from Tamanna's Gmail** (`tamannazubairisana@gmail.com`) with her CV.

## Decisions made (do not re-ask)
| Topic | Decision |
|---|---|
| Sending | Auto-send, no human approval. Safeguards instead: reviewer quality gate, nightly cap (~15–25), never email the same professor twice except one follow-up after ~12 days, **first night is a dry run**. |
| LinkedIn | Included, using a separate new account in the shared browser. **Read-only** (search/read posts), slow (~30–50 page views/night). No DMs, no connection requests, no stealth/anti-detection tooling. If restricted, other sources continue. |
| Other sources | OpenAlex, Semantic Scholar, NSF/NIH/UKRI/CORDIS/DFG grant DBs, faculty & lab pages, EURAXESS, FindAPhD, AcademicPositions, jobs.ac.uk, Google search in the browser. |
| Hosting | Website runs **locally only** (`pnpm dev` / `pnpm start` in `web/`). No hosting. |
| Database | **Neon Postgres** (shared, so both machines see the same data). URL in `web/.env` (git-ignored). |
| Claude usage | Agent runs locally through the user's Claude Code login (no separate API key). Must save progress and resume if usage limits hit. |
| "Applied" | Dashboard separates *emailed* vs *formally applied*. Portal applications (fees, rec letters) are marked `needs_manual`, not faked. |
| Honesty in emails | Every claim must be traceable to `profile/profile.md`. Never upgrade "submitted/under review" to "published". |

## Repo layout
```
Sana Agent/
├── CLAUDE.md              ← this file
├── profile/
│   ├── profile.md         ← applicant facts extracted from CV (agent's source of truth)
│   ├── Tamanna_Zubairi_Sana_CV.pdf
│   └── papers/            ← her research papers (user will add)
├── web/                   ← Next.js 16 dashboard (local)
│   ├── src/db/schema.ts   ← Drizzle schema, shared with the agent
│   ├── src/db/index.ts    ← DB client (pg for Neon; "pglite:<dir>" for offline testing)
│   ├── src/lib/session.ts ← jose-signed cookie sessions, requireUser()
│   ├── src/lib/auth.ts    ← login/logout server actions
│   ├── src/proxy.ts       ← Next 16 "proxy" (formerly middleware): redirects to /login
│   ├── src/app/(app)/     ← authenticated pages
│   ├── src/lib/actions.ts ← server actions (status/notes edits, links, learnings, replies)
│   └── scripts/           ← create-user, seed-links (real starter links), seed-demo (pglite only)
├── docs/prompt-log.md     ← every prompt, auto-appended by hook (secrets redacted)
├── .claude/               ← settings.json + hooks (memory sync)
└── agent/                 ← overnight agent (NOT BUILT YET)
```

### Dashboard pages (web/src/app/(app)/)
Overview (last run card, 8 KPIs, sent-vs-replies chart with 7d/30d/90d/1y × day/week/month,
pipeline funnel, latest replies, follow-ups due, upcoming deadlines) · Professors (search, status,
country, fit, recruiting, contacted-date range, sort, paging, CSV export) · Professor detail
(scores, summary, why-match, email+reply thread, papers, grants, positions, activity, editable
status/notes) · Positions & deadlines (status editable, ⚠ within 14 days) · Emails sent · Replies
(filter, mark handled) · Agent runs + run detail log · Learnings (approve/reject) · Useful links.

### Gotchas found while building
- `next.config.ts`: `cacheComponents: false` (all data is live) and
  `serverExternalPackages: ["@electric-sql/pglite"]` (else pglite fails inside the bundler).
- Scripts using top-level await must be `.mts`.
- Neon URL uses `sslmode=verify-full` (pg warns on `require`).
- ESLint `react-hooks/purity` flags `Date.now()` in render: use `daysFromNow()` from `lib/format.ts`.
- Preview with fake data: `DATABASE_URL=pglite:./.pglite pnpm db:push && pnpm user:create … && pnpm seed:demo && pnpm dev`.

## Web app — how to run
```bash
cd web
pnpm install
pnpm db:push            # apply schema to Neon
pnpm user:create <email> <name> <password>
pnpm dev                # http://localhost:3000
```
Notes: Next.js **16** — `middleware` is now `proxy.ts`; `params`, `searchParams`, `cookies()` are async.
Read `web/node_modules/next/dist/docs/` before using unfamiliar APIs. pnpm 11 (`allowBuilds` in
`web/pnpm-workspace.yaml`).

## Data model (web/src/db/schema.ts)
`users`, `universities`, `professors` (status pipeline: discovered → researched → shortlisted →
emailed → followed_up → replied → positive → interview → offer | rejected | skipped; scores:
fit/funding/reply/priority 0–100), `papers`, `grants`, `positions` (found/emailed/applied/
needs_manual/closed/rejected/offer, deadline), `agent_runs` (who started it, dry_run, stats json,
summary), `emails` (draft/sent/failed/blocked, review score), `replies` (classification:
positive/ask_cv/apply_formally/no_funding/negative/auto_reply/other), `activity` (per-agent log),
`learnings` (proposed skill changes), `links`.

## Agent design (planned)
Orchestrator + subagents: **Scout** (discover) → **Profiler** (papers, grants, recruiting signals)
→ **Scorer** (fit, funding, reply likelihood → priority) → **Writer** (email in her voice) →
**Reviewer** (quality gate: names, real paper, real connection, length, no filler, CV attached) →
**Sender** (Gmail API, spaced out, nightly cap) → **Inbox Watcher** (classify replies) →
**Learner** (writes learnings, adjusts scoring weights from reply outcomes; skill edits logged to
`learnings` table).

## Applicant summary (details in profile/profile.md)
BSc CSE, East Delta University (CGPA 3.81/4.00), IELTS 7.0. Research: federated learning review
(submitted IEEE Access), CNN-LSTM phishing detection (under review PLOS ONE), Bangladeshi vehicle
image dataset + CNN detection (published 2023), brain-signal decoding. Industry: E-commerce/CRO
manager (50+ A/B tests), SQA engineer. **Target research field not yet confirmed by user** —
candidates: ML for cybersecurity, federated/privacy-preserving ML, applied DL/CV, HCI/experimentation.

## Status / next steps
- [x] Plan agreed
- [x] Next.js app scaffolded, schema pushed to Neon, login system
- [x] Project memory hooks + root git repo (needs private GitHub remote to sync)
- [x] Dashboard: all pages built, type-checked, linted, production build OK, tested in browser with demo data (2026-10-28)
- [x] 13 starter links seeded into Neon (position boards, scholarships, research tools)
- [ ] Create the two user accounts (`pnpm user:create`) — needs emails + passwords from the user
- [ ] Add private GitHub remote so memory syncs between machines
- [ ] Confirm Tamanna's target field(s) and countries to exclude
- [ ] Add her papers to `profile/papers/`; recommend an academic-style CV variant (current CV is industry-style)
- [ ] Build agent (Claude Agent SDK / `claude -p`), Gmail API auth, browser (Playwright MCP) setup
- [ ] Dry-run night, then live

## Open issues to raise with the user
- CV lists the IEEE Access federated-learning review under "Published" but says "Submitted" — fix on CV; emails will say "submitted".
- The Neon password was pasted in chat; consider rotating it in Neon console at some point and updating `web/.env`.
