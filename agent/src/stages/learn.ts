import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { cfg } from "../config.ts";
import { db, t, and, desc, eq, inArray, sql } from "../db.ts";
import { ask } from "../llm.ts";
import { log } from "../log.ts";
import { scoring } from "../skills.ts";
import { rescoreAll } from "./profile.ts";

const PLAYBOOKS = ["scout", "linkedin", "profiler", "researcher", "writer", "reviewer"];

/** Writes learnings the users approved on the dashboard into the playbooks / scoring weights. */
export async function applyApprovedLearnings() {
  const approved = await db.select().from(t.learnings).where(eq(t.learnings.status, "approved"));
  for (const l of approved) {
    if (l.agent === "scorer") {
      // The proposed weights are the last line of the learning's content.
      let w: Record<string, unknown> = {};
      try {
        w = JSON.parse(l.content.trim().split("\n").pop() ?? "{}");
      } catch {}
      if (["fit", "funding", "reply"].every((k) => typeof w[k] === "number")) {
        const s = scoring() as Record<string, unknown>;
        s.weights = w;
        writeFileSync(path.join(cfg.skillsDir, "scoring.json"), JSON.stringify(s, null, 2) + "\n");
        await rescoreAll();
      }
    } else if (PLAYBOOKS.includes(l.agent)) {
      const file = path.join(cfg.skillsDir, `${l.agent}.md`);
      if (existsSync(file)) writeFileSync(file, `${readFileSync(file, "utf8").trimEnd()}\n- **${l.title}** — ${l.content.replace(/\n+/g, " ")}\n`);
    }
    await db.update(t.learnings).set({ status: "applied" }).where(eq(t.learnings.id, l.id));
    await log("learner", `Applied learning to ${l.agent}: ${l.title}`);
  }
}

const Proposals = z.object({
  learnings: z
    .array(
      z.object({
        agent: z.enum(["scout", "linkedin", "profiler", "researcher", "writer", "reviewer"]),
        title: z.string().describe("Short rule name"),
        content: z.string().describe("The rule, written as an instruction for that agent's playbook"),
      }),
    )
    .max(3),
});

/** Turns tonight's problems into at most 3 proposed playbook rules for the users to approve. */
export async function proposeLearnings(runId: number) {
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
  const existing = await db.select({ agent: t.learnings.agent, title: t.learnings.title, status: t.learnings.status }).from(t.learnings).orderBy(desc(t.learnings.createdAt)).limit(100);

  const out = await ask({
    system:
      "You improve an outreach agent's playbooks from what went wrong in its last run. Propose only rules that are specific, general enough to reuse, and would have prevented a real problem below. Never propose rules that bypass website protections, CAPTCHAs, or LinkedIn limits, or that weaken honesty checks. Propose nothing if nothing is worth learning.",
    prompt: `Problems this run:\n${issues.map((i) => `- [${i.agent}/${i.level}] ${i.message}`).join("\n") || "- none"}\n\nReviewer block reasons:\n${blocked.map((b) => `- ${b.notes}`).join("\n") || "- none"}\n\nExisting learnings (do not duplicate; rejected ones were declined by the users):\n${existing.map((e) => `- [${e.agent}, ${e.status}] ${e.title}`).join("\n") || "- none"}`,
    schema: Proposals,
    maxTurns: 2,
  });
  for (const l of out.learnings) await db.insert(t.learnings).values({ runId, ...l });
  if (out.learnings.length) await log("learner", `Proposed ${out.learnings.length} new learnings for approval`);
}

/** Once enough outcomes exist, proposes scoring weights that favour what predicted replies. */
export async function proposeWeights(runId: number) {
  const rows = await db
    .select({ fit: t.professors.fitScore, funding: t.professors.fundingScore, reply: t.professors.replyScore, status: t.professors.status })
    .from(t.emails)
    .innerJoin(t.professors, eq(t.professors.id, t.emails.professorId))
    .where(and(eq(t.emails.kind, "initial"), eq(t.emails.status, "sent"), sql`${t.emails.sentAt} < now() - interval '14 days'`));
  if (rows.length < 30) return;
  const pending = await db.select({ id: t.learnings.id }).from(t.learnings).where(and(eq(t.learnings.agent, "scorer"), eq(t.learnings.status, "proposed")));
  if (pending.length) return;

  const good = (s: string) => ["positive", "interview", "offer"].includes(s);
  const keys = ["fit", "funding", "reply"] as const;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const pos = rows.filter((r) => good(r.status));
  if (pos.length < 3) return;
  const lift = Object.fromEntries(
    keys.map((k) => [k, Math.max(0.05, mean(pos.map((r) => r[k] ?? 0)) - mean(rows.filter((r) => !good(r.status)).map((r) => r[k] ?? 0)))]),
  ) as Record<(typeof keys)[number], number>;
  const total = keys.reduce((a, k) => a + lift[k], 0);
  const cur = scoring().weights;
  // Blend half-way toward the data so one bad month cannot swing everything.
  const next = Object.fromEntries(keys.map((k) => [k, Math.round(((cur[k] + lift[k] / total) / 2) * 100) / 100])) as Record<string, number>;

  await db.insert(t.learnings).values({
    runId,
    agent: "scorer",
    title: `Re-weight scoring from ${rows.length} outcomes (${pos.length} positive)`,
    content: `Current ${JSON.stringify(cur)} → proposed ${JSON.stringify(next)}. Positive replies had higher scores on: ${keys.map((k) => `${k} +${lift[k].toFixed(1)}`).join(", ")}.\n${JSON.stringify(next)}`,
  });
  await log("learner", "Proposed new scoring weights for approval");
}
