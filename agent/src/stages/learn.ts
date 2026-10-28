import { writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { cfg } from "../config.ts";
import { db, t, and, desc, eq, inArray, sql } from "../db.ts";
import { PLAYBOOKS, learnedRules, recordChange, snapshot, upsertRule } from "../evolve.ts";
import { ask } from "../llm.ts";
import { scoring } from "../skills.ts";
import { rescoreAll } from "./profile.ts";

const Lessons = z.object({
  lessons: z
    .array(
      z.object({
        agent: z.enum(PLAYBOOKS),
        title: z.string().describe("Short rule name; reuse an existing title to improve that rule"),
        rule: z.string().describe("The rule, as an instruction for that agent"),
        why: z.string(),
      }),
    )
    .max(4),
});

/**
 * After a run: turns what went wrong (warnings, failures, reviewer blocks) into
 * playbook rules and applies them right away (snapshotted, revertible).
 */
export async function learnFromRun(runId: number) {
  const issues = await db
    .select({ agent: t.activity.agent, level: t.activity.level, message: t.activity.message })
    .from(t.activity)
    .where(and(eq(t.activity.runId, runId), inArray(t.activity.level, ["warn", "error"])))
    .limit(60);
  const blocked = await db
    .select({ notes: t.emails.reviewNotes })
    .from(t.emails)
    .where(and(eq(t.emails.status, "blocked"), sql`${t.emails.createdAt} > now() - interval '1 day'`))
    .limit(20);
  if (!issues.length && !blocked.length) return;
  const reverted = await db.select({ agent: t.learnings.agent, title: t.learnings.title }).from(t.learnings).where(eq(t.learnings.status, "reverted")).orderBy(desc(t.learnings.id)).limit(50);

  const out = await ask({
    system:
      "You improve a team of outreach agents from what went wrong in their last run. Write only rules that are specific, reusable, and would have prevented a real problem below. Never write rules that bypass website protections, CAPTCHAs, rate limits or LinkedIn rules, collect personal (non-professional) information, weaken honesty checks, or increase sending volume. Do not re-add rules the users reverted. Return nothing if nothing is worth learning.",
    prompt: `Problems this run:\n${issues.map((i) => `- [${i.agent}/${i.level}] ${i.message}`).join("\n") || "- none"}\n\nReviewer block reasons:\n${blocked.map((b) => `- ${b.notes}`).join("\n") || "- none"}\n\nCurrent learned rules:\n${PLAYBOOKS.map((a) => `### ${a}\n${learnedRules(a) || "(none)"}`).join("\n")}\n\nReverted by the users (do not re-add):\n${reverted.map((r) => `- [${r.agent}] ${r.title}`).join("\n") || "- none"}`,
    schema: Lessons,
    maxTurns: 4,
  });
  if (!out.lessons.length) return;
  const snap = snapshot(`learner-run${runId}`);
  for (const l of out.lessons)
    if (upsertRule(l.agent, l.title, l.rule, `learner, run ${runId}`))
      await recordChange({ runId, agent: l.agent, title: l.title, content: `${l.rule}\n\nWhy: ${l.why}`, snapshot: snap });
}

/** Once enough outcomes exist, shifts scoring weights toward what predicted positive replies. */
export async function reweight(runId: number) {
  const rows = await db
    .select({ fit: t.professors.fitScore, funding: t.professors.fundingScore, reply: t.professors.replyScore, status: t.professors.status })
    .from(t.emails)
    .innerJoin(t.professors, eq(t.professors.id, t.emails.professorId))
    .where(and(eq(t.emails.kind, "initial"), eq(t.emails.status, "sent"), sql`${t.emails.sentAt} < now() - interval '14 days'`));
  if (rows.length < 30) return;
  const good = (s: string) => ["positive", "interview", "offer"].includes(s);
  const pos = rows.filter((r) => good(r.status));
  if (pos.length < 3) return;
  const keys = ["fit", "funding", "reply"] as const;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const lift = Object.fromEntries(
    keys.map((k) => [k, Math.max(0.05, mean(pos.map((r) => r[k] ?? 0)) - mean(rows.filter((r) => !good(r.status)).map((r) => r[k] ?? 0)))]),
  ) as Record<(typeof keys)[number], number>;
  const total = keys.reduce((a, k) => a + lift[k], 0);
  const s = scoring();
  // Move half-way toward the data so one bad month cannot swing everything.
  const next = Object.fromEntries(keys.map((k) => [k, Math.round(((s.weights[k] + lift[k] / total) / 2) * 100) / 100])) as typeof s.weights;
  if (keys.every((k) => Math.abs(next[k] - s.weights[k]) < 0.03)) return;

  const snap = snapshot(`reweight-run${runId}`);
  writeFileSync(path.join(cfg.skillsDir, "scoring.json"), JSON.stringify({ ...s, weights: next }, null, 2) + "\n");
  await rescoreAll();
  await recordChange({
    runId,
    agent: "scorer",
    title: `Re-weighted scoring from ${rows.length} outcomes (${pos.length} positive)`,
    content: `${JSON.stringify(s.weights)} → ${JSON.stringify(next)}. Positive replies scored higher on: ${keys.map((k) => `${k} +${lift[k].toFixed(1)}`).join(", ")}.`,
    snapshot: snap,
  });
}
