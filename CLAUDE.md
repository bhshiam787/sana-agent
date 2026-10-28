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
| Parallelism | All finders run at once; profiler, deep researcher and writer share `PARALLEL` (default 16, user has Claude Max) concurrent Claude sessions. (User asked 2026-10-28: "not one task at a time".) |
| Deep research ("professor A–Z / mindset") | Per shortlisted professor, a dossier of their **public professional record**: career timeline, research trajectory, current direction, what they value in students, posted contact instructions, communication style, lab culture, recent news, verified hooks with sources, red flags. **No personal life** (family, health, politics, private accounts). Emails must follow posted instructions; "no cold emails" / "not taking students" → skipped. |
| Email gateway | Gmail via SMTP/IMAP with an **app password** (not Google Cloud OAuth): `GMAIL_USER`, `GMAIL_APP_PASSWORD` in `agent/.env`. |
| Dashboard theme | Dark (forced via `data-theme="dark"` on `<html>`). |

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
└── agent/                 ← overnight agent (Claude Agent SDK, TypeScript, run with tsx)
    ├── src/run.ts         ← orchestrator: stages, run record, dry-run gate, usage-limit stop
    ├── src/llm.ts         ← ask(): one Claude Code session → zod-validated JSON (settingSources: [])
    ├── src/pool.ts        ← bounded parallelism
    ├── src/stages/        ← scout (OpenAlex + web positions + recruiting labs), linkedin,
    │                         profile (+scoring), research (dossier), write (writer+reviewer),
    │                         send, inbox, learn
    ├── src/mail.ts        ← nodemailer SMTP send (CV attached) + imapflow inbox read
    ├── skills/*.md        ← playbooks injected into prompts; learner appends approved rules
    ├── skills/scoring.json← priority weights; learner proposes re-weighting from outcomes
    ├── targets.json       ← research queries, preferred/excluded countries, h-index window
    └── .env               ← Gmail app password etc. (git-ignored; see .env.example)
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

## Agent (built 2026-10-28)
**Full run = a pipeline where every stage runs at once** (`agent/src/run.ts`): finders keep
discovering while earlier finds are profiled, researched, written and sent. One global semaphore
caps concurrent Claude sessions at `PARALLEL` (default 16; user has Claude Max). Stops starting new work after
`RUN_HOURS` (default 8); sender continues until the nightly cap.

Order: `inbox` → `strategy` → [pipeline: finders ∥ profile ∥ research ∥ write ∥ send ∥ strategist
every 90 min] → `inbox` → `learn` (learner + reweight) → `strategy`.

Finders (all parallel):
- **Track A, advertised ("circulars")**: `positions` (one web session per topic: EURAXESS, Varbi,
  AcademicTransfer, Jobbnorge, FindAPhD, jobs.ac.uk…), `labs` (one session per preferred country:
  "we are recruiting" pages), `linkedin` (read-only, optional).
- **Track B, silent funding**: `scout` (OpenAlex senior authors), `nsf` (active NSF grants by short
  keyword → PI + email; 112 grants / 102 professors on first run), `directory` (top universities per
  country + the wealthy list, swept department by department; wealthy first).
- Profiler adds a **recently hired** signal (startup funds) and a **wealthy university** bonus.

Self-improvement (user asked 2026-10-28 for autonomous authority, no approval):
- **Strategist** (`stages/strategist.ts`) reads DB aggregates (by country, source, topic, positions,
  grants, problems, blocks, replies) and decides: add/drop topics, grant keywords, country order,
  country/topic priority boosts (±10), playbook rules. Writes `agent/strategy.json` (layered over
  human-owned `targets.json`) and Learned-rules sections.
- **Learner** (`stages/learn.ts`) turns each run's failures into rules; **reweight** shifts scoring
  weights from reply outcomes (≥30 outcomes).
- Guardrails: only the "## Learned rules" section of a playbook is editable (above it is locked);
  every change snapshots files to `agent/skills/history/` and is recorded in `learnings` (status
  `applied`); dashboard **Learnings & strategy** page shows current focus and has Revert (restores
  snapshot, marks it and later changes `reverted`; learner won't re-add reverted rules).

Countries: `allowCountries` = wealthy, funding countries (US, CA, GB, IE, Western Europe, Nordics,
AU, NZ, JP, KR, SG, HK, TW, IL). `preferCountries` puts **US and Canada first** (user: "USA, Canada
give lots of funding"), then salaried-PhD Europe. `wealthyUniversities` (85: MIT…Toronto, ETH, KAUST,
MBZUAI…) are allowed even outside the list, swept first, +15 funding.

Safety rails: live mode needs a completed dry run that drafted emails; only one run at a time
across machines (`--force` if a crashed run is stuck); Claude usage limit → `stopped`, resumes next
run; LLM sessions are `dontAsk` with only WebSearch/WebFetch (Playwright MCP for LinkedIn).

### How to run (in `agent/`)
```bash
pnpm install
cp .env.example .env              # GMAIL_APP_PASSWORD, RUN_AS, OPENALEX_API_KEY
pnpm dry                          # full pipeline, sends nothing; read drafts on the dashboard
pnpm night                        # live; caffeinate keeps the Mac awake
pnpm run:agent --stages nsf,directory --hours 2   # any subset, batch mode
pnpm linkedin:login               # once, separate LinkedIn account
```
Without `OPENALEX_API_KEY` OpenAlex returns 429 after ~100 calls (shared free budget).

Dry runs no longer need Gmail: if `GMAIL_*` is unset the inbox check is skipped with a warning
(live runs and `--stages inbox` still require it).

### Tested (2026-10-28, against Neon; nothing sent)
OpenAlex 115 profs · NSF 102 profs · directory sweeps Princeton + Cornell (8 each, real emails,
grant signals) · profiler 2 · dossier+draft (review 88, deleted) · strategist run 9 (boosts + 5
rules). 49 leftover out-of-country candidates marked skipped; 182 in research queue.

## Applicant summary (details in profile/profile.md)
BSc CSE, East Delta University (CGPA 3.81/4.00), IELTS 7.0. Published: federated learning
systematic review (IEEE Access 2025, first author, ~20 citations), Sorokh-Poth vehicle dataset +
ResNet-50 (IJRP 2023, first author), brain-signal/HAR book chapter (River/CRC 2025, 4th author).
Under review: CNN-LSTM phishing detection (PLOS ONE). Scholar: user=hF4wEE4AAAAJ. Industry: E-commerce/CRO
manager (50+ A/B tests), SQA engineer. **Direction (2026-10-28): secure & trustworthy ML** (ML for cybersecurity + privacy-preserving/FL +
adversarial robustness + LLM security). Draft research statement in profile.md awaits Tamanna's
confirmation; targets.json topics refocused to match (BCI dropped, A/B kept as causal inference).

## Status / next steps
- [x] Plan agreed
- [x] Next.js app scaffolded, schema pushed to Neon, login system
- [x] Project memory hooks + root git repo (needs private GitHub remote to sync)
- [x] Dashboard: all pages built, type-checked, linted, production build OK, tested in browser with demo data (2026-10-28)
- [x] 13 starter links seeded into Neon (position boards, scholarships, research tools)
- [x] User login created: bhsam787@gmail.com (user chose the password). Tamanna's login still to create.
- [ ] Add private GitHub remote so memory syncs between machines
- [x] Field: AI/ML + cybersecurity + data science (user) → focused as secure & trustworthy ML
- [ ] Tamanna to confirm/edit the draft research statement in profile/profile.md
- [ ] Add her papers to `profile/papers/`; recommend an academic-style CV variant (current CV is industry-style)
- [x] Agent built: 10 agents/stages, playbooks, parallelism, deep research dossier, learner (2026-10-28)
- [x] Dashboard shows dossier on professor page; site is dark
- [x] Pipeline parallelism, Track A/B finders, wealthy universities, strategist + autonomous learner (2026-10-28)
- [ ] Tamanna: Gmail app password into `agent/.env`; `RUN_AS` set; free OpenAlex API key
- [~] First full dry run started 2026-10-28 11:24 (run #10, 2h, 16 parallel, started as bhsam787@gmail.com; log `agent/state/dry-run.log`). Next: read drafts together, then `pnpm night` (needs Gmail).
- [ ] Optional: `pnpm linkedin:login` with the separate account, then `LINKEDIN_ENABLED=1`

## Her papers (2026-10-28)
- `profile/papers/Sana2025_Advancing_Federated_Learning_IEEE_Access.pdf` downloaded (open access,
  CC-BY, via the visible browser). Sorokh-Poth PDF needs a manual download; the CRC/River chapter
  is paywalled.
- `profile/papers/fl_review_references.json`: 211 references parsed with `unpdf`.
  `agent/src/citations.ts` matches professors (surname + first initial) → "she cited your work"
  hook in profiler/researcher/writer prompts; researcher must confirm same person; reviewer blocks
  unsupported claims. 41/233 collected professors matched (some false positives on common surnames).
- **Warm contacts** (`targets.json → warmContacts`, never auto-emailed; addProfessor marks them
  skipped): Shahab Abdulla (UniSQ, AU; recruiting PhD students per his bio, top lead), Asif Karim
  (CDU, AU), Md. Mehedi Hassan (funded PhD at UniSA), Anindya Nag, Ayontika Das.

## Git
Single repo at the project root (the scaffold's `web/.git` was removed on day 1). **No remote yet**:
user wants everything pushed to one GitHub repo; needs a private repo URL (gh CLI not installed).

## Information requested from the user (2026-10-28), to improve the agents
Must: Tamanna's confirmation of the draft research statement · paper PDFs (optional; metadata+abstracts
already verified) · target intake + PhD-only vs funded masters OK · final-year project/thesis (title,
supervisor) · 2–3 of her own emails (voice). Useful: GitHub/Scholar/ORCID links · GRE/TOEFL, IELTS
expiry · professors already contacted (dedupe) · exclusions (countries/topics/language/visa/min
stipend) · recommenders. After dry run: her edits to drafts → writer rules. Offered: academic-style
CV draft (current CV is industry-first with photo).

## Open issues to raise with the user
- (Resolved 2026-10-28) The IEEE Access FL review IS published (2025, first author, DOI 10.1109/ACCESS.2025.3605165). Her CV wording "Submitted to IEEE Access" under "Published" is outdated; suggest updating the CV to the DOI.
- The Neon password was pasted in chat; consider rotating it in Neon console at some point and updating `web/.env`.
