import { z } from "zod";
import { cfg } from "../config.ts";
import { db, t, and, desc, eq, inArray, isNotNull, sql } from "../db.ts";
import { ask, UsageLimitError } from "../llm.ts";
import { bump, log } from "../log.ts";
import { pool } from "../pool.ts";
import { applicantProfile, skill } from "../skills.ts";

const Draft = z.object({ subject: z.string(), body: z.string() });
const Review = z.object({
  pass: z.boolean(),
  score: z.number().min(0).max(100),
  issues: z.array(z.string()).describe("Concrete, fixable problems; empty if none"),
});

type Prof = typeof t.professors.$inferSelect;

async function professorContext(p: Prof) {
  const [uni] = p.universityId ? await db.select().from(t.universities).where(eq(t.universities.id, p.universityId)) : [];
  const papers = await db.select().from(t.papers).where(eq(t.papers.professorId, p.id));
  const positions = await db.select().from(t.positions).where(eq(t.positions.professorId, p.id));
  return [
    `Name: ${p.fullName}`,
    `Title: ${p.title ?? "unknown"}`,
    `University: ${uni?.name ?? "unknown"} (${p.country ?? "?"}), department: ${p.department ?? "unknown"}`,
    `Email: ${p.email}`,
    `Current research: ${p.summary ?? ""}`,
    `Why the applicant fits: ${p.whyMatch ?? ""}`,
    `Recruiting evidence: ${p.recruitingEvidence ?? "none found"}`,
    `Recent papers (the ONLY papers you may mention):\n${papers.map((x) => `- "${x.title}" (${x.year ?? "?"}${x.venue ? `, ${x.venue}` : ""}): ${x.summary ?? ""}`).join("\n") || "- none collected"}`,
    p.contactInstructions ? `THEIR INSTRUCTIONS FOR PROSPECTIVE STUDENTS (must follow): ${p.contactInstructions}` : "",
    p.dossier
      ? `Deep research:\n- Career: ${p.dossier.careerTimeline.map((c) => `${c.year} ${c.event}`).join("; ")}\n- Trajectory: ${p.dossier.researchTrajectory}\n- Heading now: ${p.dossier.currentDirection}\n- What they value in students: ${p.dossier.valuesInStudents}\n- How they write (match this register): ${p.dossier.communicationStyle}\n- Lab culture: ${p.dossier.labCulture}\n- Recent news: ${p.dossier.recentNews.join("; ")}\n- Hooks you may use (verified):\n${p.dossier.hooks.map((h) => `  * ${h.point} [${h.source}]`).join("\n")}`
      : "",
    positions.length ? `Open positions: ${positions.map((x) => `"${x.title}" ${x.url} deadline ${x.deadline ?? "open"}`).join("; ")}` : "",
  ].join("\n");
}

/** Cheap deterministic checks before the reviewer runs. */
export function codeChecks(d: z.infer<typeof Draft>, p: Prof): string[] {
  const issues: string[] = [];
  const words = d.body.trim().split(/\s+/).length;
  const last = p.fullName.trim().split(/\s+/).pop() ?? "";
  if (words < 110 || words > 270) issues.push(`Body is ${words} words; keep it between 150 and 230.`);
  if (last && !d.body.includes(last)) issues.push(`Greeting must use the professor's last name "${last}".`);
  if (/\[[^\]]*\]|<[^>]+>|TODO|Professor X|\{\{/i.test(d.subject + d.body)) issues.push("Contains a placeholder.");
  if (/(published|accepted|appeared)[^.]{0,80}PLOS ONE|PLOS ONE[^.]{0,40}(published|accepted)/i.test(d.body))
    issues.push("The PLOS ONE phishing paper is under review; do not call it published/accepted.");
  if (d.subject.length > 110) issues.push("Subject too long.");
  return issues;
}

async function draftAndReview(p: Prof, kind: "initial" | "follow_up", previous?: { subject: string; body: string }) {
  const ctx = await professorContext(p);
  const profile = applicantProfile();
  let draft = null as z.infer<typeof Draft> | null;
  let review: z.infer<typeof Review> = { pass: false, score: 0, issues: [] };
  let feedback: string[] = [];

  for (let attempt = 1; attempt <= 3; attempt++) {
    const last = draft;
    draft = await ask({
      system: `You write outreach emails for a graduate applicant, in her voice (warm, direct, precise).\n\n${skill("writer")}`,
      prompt: `${kind === "follow_up" ? `Write the ONE polite follow-up to this earlier email that got no reply:\nSubject: ${previous!.subject}\n${previous!.body}\n\n` : "Write the first email.\n\n"}Applicant profile (the only facts you may use about her):\n${profile}\n\nProfessor:\n${ctx}\n\nSign with: Tamanna Zubairi Sana, ${cfg.gmailUser || "tamannazubairisana@gmail.com"}, https://www.linkedin.com/in/tamanna-zubairi-sana-4659b8219${feedback.length ? `\n\nFix these problems from the last draft:\n- ${feedback.join("\n- ")}\n\nLast draft:\nSubject: ${last?.subject}\n${last?.body}` : ""}`,
      schema: Draft,
      maxTurns: 3,
    });
    const hard = kind === "initial" ? codeChecks(draft, p) : [];
    if (hard.length) {
      feedback = hard;
      review = { pass: false, score: 0, issues: hard };
      continue;
    }
    review = await ask({
      system: `You are a strict reviewer of outreach emails sent with no human check.\n\n${skill("reviewer")}`,
      prompt: `Applicant profile:\n${profile}\n\nProfessor data:\n${ctx}\n\nEmail type: ${kind}\nTo: ${p.email}\nSubject: ${draft.subject}\n\n${draft.body}`,
      schema: Review,
      maxTurns: 3,
      effort: "high",
    });
    if (review.pass && (review.score >= 88 || review.issues.length === 0)) break;
    feedback = review.issues.length ? review.issues : ["Make it more specific to this professor's work."];
  }
  return { draft: draft!, review };
}

/** How many more initial emails fit under tonight's cap (sent in the last 20h + waiting drafts). */
export async function writeRoom() {
  const [{ sentToday }] = await db
    .select({ sentToday: sql<number>`count(*)::int` })
    .from(t.emails)
    .where(and(eq(t.emails.status, "sent"), sql`${t.emails.sentAt} > now() - interval '20 hours'`));
  return Math.max(0, cfg.nightlyEmailCap - sentToday - (await countDrafts()));
}

/** Researched, shortlisted professors with an email and no email yet, best first. */
export async function nextToWrite(inFlight: Set<number>, limit = 1) {
  const rows = await db
    .select()
    .from(t.professors)
    .where(
      and(
        eq(t.professors.status, "shortlisted"),
        isNotNull(t.professors.dossier),
        isNotNull(t.professors.email),
        sql`not exists (select 1 from emails e where e.professor_id = ${t.professors.id} and e.status in ('draft','sent'))`,
      ),
    )
    .orderBy(desc(t.professors.priorityScore))
    .limit(limit + inFlight.size);
  return rows.filter((p) => !inFlight.has(p.id)).slice(0, limit);
}

/** Batch mode for `--stages write`. */
export async function writeEmails() {
  const room = await writeRoom();
  if (room) await pool(await nextToWrite(new Set(), room), cfg.parallel, writeOne);
}

/** Writer → code checks → reviewer for one professor; stores a draft or a blocked email. */
export async function writeOne(p: Prof) {
    try {
      const { draft, review } = await draftAndReview(p, "initial");
      const ok = review.pass && review.score >= 75;
      await db.insert(t.emails).values({
        professorId: p.id,
        runId: null,
        toAddress: p.email!,
        subject: draft.subject,
        body: draft.body,
        attachments: [cfg.cvPath.split("/").pop()!],
        status: ok ? "draft" : "blocked",
        reviewScore: review.score,
        reviewNotes: review.issues.join(" | ") || null,
      });
      bump(ok ? "drafts_ready" : "blocked_by_reviewer");
      await log(ok ? "writer" : "reviewer", ok ? `Draft ready for ${p.fullName} (review ${review.score})` : `Blocked email to ${p.fullName}: ${review.issues.join("; ")}`, {
        professorId: p.id,
        level: ok ? "info" : "warn",
      });
      if (!ok) await db.update(t.professors).set({ notes: `Email blocked by reviewer: ${review.issues.join("; ")}`.slice(0, 1000) }).where(eq(t.professors.id, p.id));
    } catch (e) {
      if (e instanceof UsageLimitError) throw e;
      await log("writer", `Failed on ${p.fullName}: ${(e as Error).message}`, { level: "warn", professorId: p.id });
    }
}

async function countDrafts() {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(t.emails).where(eq(t.emails.status, "draft"));
  return n;
}

/** Drafts the single follow-up for professors whose first email is old and unanswered. */
export async function writeFollowUps() {
  const due = await db
    .select()
    .from(t.professors)
    .where(and(eq(t.professors.status, "emailed"), sql`${t.professors.nextFollowUpAt} <= now()`));
  for (const p of due) {
    const sent = await db.select().from(t.emails).where(and(eq(t.emails.professorId, p.id), eq(t.emails.status, "sent")));
    if (sent.length !== 1 || sent[0].kind !== "initial") continue;
    const replied = await db.select({ id: t.replies.id }).from(t.replies).where(eq(t.replies.professorId, p.id)).limit(1);
    if (replied.length) continue;
    try {
      const { draft, review } = await draftAndReview(p, "follow_up", sent[0]);
      const ok = review.pass && review.score >= 75;
      await db.insert(t.emails).values({
        professorId: p.id,
        kind: "follow_up",
        toAddress: p.email!,
        subject: sent[0].subject.startsWith("Re:") ? sent[0].subject : `Re: ${sent[0].subject}`,
        body: draft.body,
        status: ok ? "draft" : "blocked",
        reviewScore: review.score,
        reviewNotes: review.issues.join(" | ") || null,
        gmailThreadId: sent[0].gmailMessageId,
      });
      await db.update(t.professors).set({ nextFollowUpAt: null }).where(eq(t.professors.id, p.id));
      bump(ok ? "follow_ups_ready" : "blocked_by_reviewer");
      await log(ok ? "writer" : "reviewer", `${ok ? "Follow-up ready" : "Follow-up blocked"} for ${p.fullName}`, { professorId: p.id });
    } catch (e) {
      if (e instanceof UsageLimitError) throw e;
      await log("writer", `Follow-up failed for ${p.fullName}: ${(e as Error).message}`, { level: "warn", professorId: p.id });
    }
  }
}
