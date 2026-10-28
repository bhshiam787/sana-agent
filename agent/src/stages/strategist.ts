import { writeFileSync } from "node:fs";
import { z } from "zod";
import { db, t, and, desc, eq, sql } from "../db.ts";
import { PLAYBOOKS, learnedRules, recordChange, retireRule, snapshot, upsertRule } from "../evolve.ts";
import { ask } from "../llm.ts";
import { log } from "../log.ts";
import { applicantProfile, strategy, strategyPath, targets } from "../skills.ts";

const Decision = z.object({
  assessment: z.string().describe("What the data says right now, 3-6 sentences"),
  addQueries: z.array(z.object({ query: z.string(), why: z.string() })).max(3).describe("New research topics to search, must fit the applicant"),
  dropQueries: z.array(z.object({ query: z.string(), why: z.string() })).max(2).describe("Current topics that are not paying off"),
  addGrantKeywords: z.array(z.string()).max(3).describe("Short (1-3 word) grant search keywords"),
  countryPriority: z.array(z.string()).describe("Full ordered list of ISO country codes to try first; empty to keep the current order"),
  countryBoost: z.record(z.string(), z.number().min(-10).max(10)).describe("Extra priority points per ISO country"),
  topicBoost: z.record(z.string(), z.number().min(0).max(10)).describe("Extra priority points for professors whose research areas match"),
  playbookRules: z
    .array(z.object({ agent: z.enum(PLAYBOOKS), title: z.string(), rule: z.string(), why: z.string() }))
    .max(5)
    .describe("New or improved rules for an agent's Learned rules section"),
  retireRules: z.array(z.object({ agent: z.enum(PLAYBOOKS), title: z.string(), why: z.string() })).max(3),
});

async function snapshotData() {
  const byCountry = await db.execute(sql`
    select p.country,
      count(*)::int as found,
      count(*) filter (where p.status <> 'discovered')::int as researched,
      count(*) filter (where p.status in ('shortlisted','emailed','followed_up','replied','positive','interview','offer'))::int as shortlisted,
      count(*) filter (where p.recruiting)::int as recruiting,
      round(avg(p.fit_score))::int as avg_fit,
      round(avg(p.funding_score))::int as avg_funding,
      count(*) filter (where p.status in ('emailed','followed_up','replied','positive','interview','offer','rejected'))::int as emailed,
      count(*) filter (where p.status in ('replied','positive','interview','offer','rejected'))::int as replied,
      count(*) filter (where p.status in ('positive','interview','offer'))::int as positive
    from professors p group by p.country order by found desc limit 30`);
  const bySource = await db.execute(sql`
    select source, count(*)::int as found,
      count(*) filter (where status in ('shortlisted','emailed','followed_up','replied','positive','interview','offer'))::int as shortlisted,
      round(avg(fit_score))::int as avg_fit
    from professors group by source order by found desc`);
  const hotAreas = await db.execute(sql`
    select area, count(*)::int as n, round(avg(p.funding_score))::int as avg_funding, count(*) filter (where p.recruiting)::int as recruiting
    from professors p, unnest(p.research_areas) area
    where p.fit_score >= 50 group by area order by n desc limit 25`);
  const positions = await db.execute(sql`
    select source, country, count(*)::int as n from positions
    where deadline is null or deadline >= current_date group by source, country order by n desc limit 30`);
  const grants = await db.execute(sql`select funder, count(*)::int as n, round(avg(amount))::int as avg_amount from grants where end_date >= current_date group by funder order by n desc limit 10`);
  const problems = await db
    .select({ agent: t.activity.agent, message: t.activity.message })
    .from(t.activity)
    .where(and(sql`${t.activity.level} in ('warn','error')`, sql`${t.activity.at} > now() - interval '24 hours'`))
    .orderBy(desc(t.activity.id))
    .limit(40);
  const blocked = await db
    .select({ notes: t.emails.reviewNotes })
    .from(t.emails)
    .where(and(eq(t.emails.status, "blocked"), sql`${t.emails.createdAt} > now() - interval '3 days'`))
    .limit(15);
  const replies = await db.execute(sql`
    select r.classification, p.country, p.research_areas[1] as area, r.snippet
    from replies r join professors p on p.id = r.professor_id order by r.received_at desc limit 20`);
  return { byCountry: byCountry.rows, bySource: bySource.rows, hotAreas: hotAreas.rows, positions: positions.rows, grants: grants.rows, problems, blocked, replies: replies.rows };
}

/**
 * Watches everything the other agents produced and decides where to focus:
 * topics, countries, grant keywords, priority boosts, and playbook rules.
 * Applies its decisions itself (snapshotted, revertible on the dashboard).
 */
export async function strategize(runId: number | null) {
  const data = await snapshotData();
  const tg = targets();
  const s = strategy();
  const rules = PLAYBOOKS.map((a) => `### ${a}\n${learnedRules(a) || "(none)"}`).join("\n\n");

  const d = await ask({
    system: `You are the strategist of a team of agents that find fully funded PhD / funded masters supervisors for one applicant and email them. You watch all results and decide where the team should focus next, and you keep every agent's playbook up to date with what the team has learned.

Principles:
- Follow evidence in the data (where funding, recruiting signals, good fit and replies actually appear). Do not chase a topic only because it is well funded if it does not fit the applicant's real background.
- Prefer small, reversible moves; change course only when the numbers support it. Early on, with little data, mostly keep the current plan.
- Countries: only codes from the allowed list or with a well-funded university. US and Canada fund most PhDs through grants (RA/TA + tuition + insurance); Nordic/Dutch/Swiss/German PhDs are salaried jobs.
- Playbook rules must be concrete, reusable instructions that would have prevented a real problem or repeated a real success seen in the data. Never write rules that bypass website protections, CAPTCHAs, rate limits or LinkedIn rules, collect personal (non-professional) information about professors, weaken honesty about the applicant, or raise sending volume.
- You may use web search briefly to check a funding trend (e.g. a large new national programme in a topic) before acting on it.`,
    prompt: `Applicant:\n${applicantProfile()}\n\nCurrent plan:\n- Research topics: ${tg.researchQueries.join("; ")}\n- Grant keywords: ${tg.grantKeywords.join(", ")}\n- Country order: ${tg.preferCountries.join(", ")}\n- Allowed countries: ${tg.allowCountries.join(", ")}\n- Current boosts: countries ${JSON.stringify(s.countryBoost)}, topics ${JSON.stringify(s.topicBoost)}\n- Last assessment: ${s.lastAssessment ?? "none"}\n\nData:\n${JSON.stringify(data, null, 1)}\n\nCurrent learned rules per agent:\n${rules}\n\nDecide the next focus. Return empty lists for anything you would not change.`,
    schema: Decision,
    tools: ["WebSearch"],
    maxTurns: 12,
    effort: "high",
  });

  const allowed = new Set([...tg.allowCountries, ...tg.wealthyUniversities.map((w) => w.country)]);
  const next = { ...s };
  const changes: string[] = [];
  for (const q of d.addQueries)
    if (!tg.researchQueries.some((x) => x.toLowerCase() === q.query.toLowerCase()) && tg.researchQueries.length + next.addQueries.length < 15) {
      next.addQueries = [...next.addQueries, q.query];
      changes.push(`+ topic "${q.query}": ${q.why}`);
    }
  for (const q of d.dropQueries)
    if (tg.researchQueries.length - 1 >= 3 && tg.researchQueries.some((x) => x.toLowerCase() === q.query.toLowerCase())) {
      next.dropQueries = [...next.dropQueries, q.query];
      changes.push(`− topic "${q.query}": ${q.why}`);
    }
  const newKeywords = d.addGrantKeywords.filter((k) => k.split(/\s+/).length <= 3 && !tg.grantKeywords.includes(k));
  if (newKeywords.length) {
    next.addGrantKeywords = [...next.addGrantKeywords, ...newKeywords];
    changes.push(`+ grant keywords: ${newKeywords.join(", ")}`);
  }
  const order = d.countryPriority.filter((c) => allowed.has(c));
  if (order.length >= 3 && order.join() !== tg.preferCountries.join()) {
    next.countryPriority = order;
    changes.push(`country order → ${order.join(", ")}`);
  }
  const clamp = (r: Record<string, number>, lo: number, hi: number) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Math.max(lo, Math.min(hi, Math.round(v)))]));
  const cb = clamp(Object.fromEntries(Object.entries(d.countryBoost).filter(([c]) => allowed.has(c))), -10, 10);
  const tb = clamp(d.topicBoost, 0, 10);
  if (JSON.stringify(cb) !== JSON.stringify(s.countryBoost)) changes.push(`country boosts → ${JSON.stringify(cb)}`);
  if (JSON.stringify(tb) !== JSON.stringify(s.topicBoost)) changes.push(`topic boosts → ${JSON.stringify(tb)}`);
  next.countryBoost = cb;
  next.topicBoost = tb;

  const ruleChanges = d.playbookRules.length + d.retireRules.length;
  if (!changes.length && !ruleChanges) {
    writeFileSync(strategyPath(), JSON.stringify({ ...s, lastAssessment: d.assessment, updatedAt: new Date().toISOString() }, null, 2) + "\n");
    await log("learner", `Strategist: no change. ${d.assessment}`);
    return;
  }

  const snap = snapshot(`strategist-run${runId ?? "x"}`);
  next.lastAssessment = d.assessment;
  next.updatedAt = new Date().toISOString();
  writeFileSync(strategyPath(), JSON.stringify(next, null, 2) + "\n");
  if (changes.length)
    await recordChange({ runId, agent: "strategist", title: `Focus update (${changes.length} change${changes.length > 1 ? "s" : ""})`, content: `${d.assessment}\n\n${changes.join("\n")}`, snapshot: snap });

  for (const r of d.playbookRules)
    if (upsertRule(r.agent, r.title, r.rule, `strategist, run ${runId ?? "?"}`))
      await recordChange({ runId, agent: r.agent, title: r.title, content: `${r.rule}\n\nWhy: ${r.why}`, snapshot: snap });
  for (const r of d.retireRules)
    if (retireRule(r.agent, r.title)) await recordChange({ runId, agent: r.agent, title: `Retired: ${r.title}`, content: r.why, snapshot: snap });
}
