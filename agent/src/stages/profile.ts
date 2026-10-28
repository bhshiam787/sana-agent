import { z } from "zod";
import { cfg } from "../config.ts";
import { db, t, and, asc, desc, eq, isNull, sql } from "../db.ts";
import { ask, UsageLimitError } from "../llm.ts";
import { bump, log } from "../log.ts";
import { pool } from "../pool.ts";
import { applicantProfile, scoring, skill, targets } from "../skills.ts";

const ProfileOut = z.object({
  found: z.boolean().describe("false if the person could not be identified confidently"),
  active: z.boolean().describe("false if emeritus, retired, moved to industry, or deceased"),
  title: z.string().nullable().describe("Assistant Professor / Associate Professor / Professor / Lecturer / Researcher"),
  department: z.string().nullable(),
  email: z.string().nullable().describe("Only from an official page; null if not found"),
  homepage: z.string().nullable(),
  labUrl: z.string().nullable(),
  scholarUrl: z.string().nullable(),
  linkedinUrl: z.string().nullable(),
  researchAreas: z.array(z.string()).max(8),
  summary: z.string().describe("3-5 sentences: what they work on now, in plain words"),
  recentPapers: z
    .array(z.object({ title: z.string(), year: z.number().nullable(), venue: z.string().nullable(), url: z.string().nullable(), summary: z.string() }))
    .max(6),
  recruiting: z.boolean(),
  recruitingEvidence: z.string().nullable().describe("Quote + URL, or null"),
  grants: z
    .array(z.object({ funder: z.string(), title: z.string().nullable(), startYear: z.number().nullable(), endYear: z.number().nullable(), url: z.string().nullable() }))
    .max(8),
  fitScore: z.number().min(0).max(100).describe("How well the applicant fits this lab's current work"),
  whyMatch: z.string().describe("2-4 sentences: the concrete overlap between the applicant and this professor"),
  fundingEvidenceScore: z.number().min(0).max(100).describe("Evidence they can fund a student now"),
});

export function computeScores(p: {
  fit: number;
  fundingEvidence: number;
  activeGrants: number;
  recruiting: boolean;
  country: string | null;
  title: string | null;
  hIndex: number | null;
}) {
  const s = scoring();
  const salaried = p.country ? s.salariedPhdCountries.includes(p.country) : false;
  const funding = Math.min(100, p.fundingEvidence * 0.6 + Math.min(p.activeGrants, 3) * 10 + (p.recruiting ? 15 : 0) + (salaried ? 10 : 0));
  let reply = 30;
  if (/assistant/i.test(p.title ?? "")) reply += s.replyBonus.assistantProfessor;
  else if (/associate/i.test(p.title ?? "")) reply += s.replyBonus.associateProfessor;
  if (p.recruiting) reply += s.replyBonus.recruiting;
  if (p.hIndex != null && p.hIndex >= 10 && p.hIndex <= 40) reply += s.replyBonus.hIndexSweetSpot;
  reply = Math.min(100, reply);
  const w = s.weights;
  const priority = p.fit * w.fit + funding * w.funding + reply * w.reply;
  return { funding: Math.round(funding), reply: Math.round(reply), priority: Math.round(priority) };
}

/** Researches discovered professors one by one (recruiting first, then by h-index). */
export async function profileProfessors() {
  const prefer = targets().preferCountries;
  const queue = await db
    .select({ p: t.professors, uni: t.universities.name })
    .from(t.professors)
    .leftJoin(t.universities, eq(t.universities.id, t.professors.universityId))
    .where(eq(t.professors.status, "discovered"))
    .orderBy(
      desc(t.professors.recruiting),
      // Countries where PhDs are reliably funded first, then smaller labs (likelier to reply).
      desc(prefer.length ? sql`${t.professors.country} in (${sql.join(prefer.map((c) => sql`${c}`), sql`, `)})` : sql`false`),
      sql`${t.professors.hIndex} asc nulls last`,
      asc(t.professors.id),
    )
    .limit(cfg.profilePerRun);

  const profile = applicantProfile();
  await pool(queue, cfg.parallel, async ({ p, uni }) => {
    try {
      const r = await ask({
        system: `You research university professors for a graduate applicant. Be accurate; never invent facts, URLs or emails.\n\n${skill("profiler")}`,
        prompt: `Applicant profile:\n${profile}\n\nProfessor to research: ${p.fullName}${uni ? `, ${uni}` : ""}${p.country ? ` (${p.country})` : ""}.\nKnown topics: ${(p.researchAreas ?? []).join(", ") || "unknown"}.\n${p.sourceUrl ? `Found via: ${p.sourceUrl}\n` : ""}Today is ${new Date().toISOString().slice(0, 10)}.`,
        schema: ProfileOut,
        tools: ["WebSearch", "WebFetch"],
        maxTurns: 25,
      });

      if (!r.found || !r.active) {
        await db.update(t.professors).set({ status: "skipped", notes: r.found ? "Not active (emeritus/moved)" : "Could not identify", updatedAt: new Date() }).where(eq(t.professors.id, p.id));
        await log("profiler", `Skipped ${p.fullName}: ${r.found ? "not active" : "not identified"}`, { professorId: p.id });
        return;
      }

      const year = new Date().getFullYear();
      const activeGrants = r.grants.filter((g) => (g.endYear ?? 0) >= year).length;
      const sc = computeScores({ fit: r.fitScore, fundingEvidence: r.fundingEvidenceScore, activeGrants, recruiting: r.recruiting || p.recruiting, country: p.country, title: r.title, hIndex: p.hIndex });
      const email = r.email?.trim().toLowerCase() || null;
      const emailTaken = email
        ? (await db.select({ id: t.professors.id }).from(t.professors).where(and(eq(t.professors.email, email), sql`${t.professors.id} <> ${p.id}`))).length > 0
        : false;
      const status = emailTaken ? "skipped" : email && sc.priority >= cfg.shortlistMin ? "shortlisted" : "researched";

      await db.transaction(async (tx) => {
        await tx
          .update(t.professors)
          .set({
            title: r.title,
            department: r.department,
            email: emailTaken ? null : email,
            homepage: r.homepage,
            labUrl: r.labUrl,
            scholarUrl: r.scholarUrl,
            linkedinUrl: r.linkedinUrl,
            researchAreas: r.researchAreas.length ? r.researchAreas : p.researchAreas,
            summary: r.summary,
            whyMatch: r.whyMatch,
            recentPapers: r.recentPapers.filter((x) => (x.year ?? 0) >= year - 2).length,
            recruiting: r.recruiting || p.recruiting,
            recruitingEvidence: r.recruitingEvidence ?? p.recruitingEvidence,
            fitScore: r.fitScore,
            fundingScore: sc.funding,
            replyScore: sc.reply,
            priorityScore: sc.priority,
            status,
            notes: emailTaken ? "Duplicate of another professor record (same email)" : !email ? "No official email found" : p.notes,
            updatedAt: new Date(),
          })
          .where(eq(t.professors.id, p.id));
        await tx.delete(t.papers).where(eq(t.papers.professorId, p.id));
        if (r.recentPapers.length)
          await tx.insert(t.papers).values(r.recentPapers.map((x) => ({ professorId: p.id, title: x.title, year: x.year, venue: x.venue, url: x.url, summary: x.summary })));
        await tx.delete(t.grants).where(eq(t.grants.professorId, p.id));
        if (r.grants.length)
          await tx.insert(t.grants).values(
            r.grants.map((g) => ({
              professorId: p.id,
              funder: g.funder,
              title: g.title,
              startDate: g.startYear ? `${g.startYear}-01-01` : null,
              endDate: g.endYear ? `${g.endYear}-12-31` : null,
              url: g.url,
            })),
          );
      });
      bump("researched");
      if (status === "shortlisted") bump("shortlisted");
      await log("profiler", `${p.fullName}: fit ${r.fitScore}, funding ${sc.funding}, priority ${sc.priority} → ${status}`, { professorId: p.id });
    } catch (e) {
      if (e instanceof UsageLimitError) throw e;
      await log("profiler", `Failed on ${p.fullName}: ${(e as Error).message}`, { level: "warn", professorId: p.id });
    }
  });
}

/** Recompute priority from stored scores after the scoring weights change. */
export async function rescoreAll() {
  const w = scoring().weights;
  const rows = await db.select().from(t.professors).where(and(sql`${t.professors.fitScore} is not null`, isNull(t.professors.lastContactedAt)));
  for (const p of rows) {
    const priority = Math.round(p.fitScore! * w.fit + (p.fundingScore ?? 0) * w.funding + (p.replyScore ?? 0) * w.reply);
    const status = p.status === "researched" && p.email && priority >= cfg.shortlistMin ? "shortlisted" : p.status;
    await db.update(t.professors).set({ priorityScore: priority, status }).where(eq(t.professors.id, p.id));
  }
}
