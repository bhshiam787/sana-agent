import { z } from "zod";
import { cfg } from "../config.ts";
import { db, t, and, desc, eq, isNull } from "../db.ts";
import { ask, UsageLimitError } from "../llm.ts";
import { bump, log } from "../log.ts";
import { citationNote } from "../citations.ts";
import { pool } from "../pool.ts";
import { applicantProfile, skill } from "../skills.ts";

const DossierOut = z.object({
  careerTimeline: z.array(z.object({ year: z.string(), event: z.string() })).max(20),
  researchTrajectory: z.string(),
  currentDirection: z.string(),
  valuesInStudents: z.string().describe("What they look for in students, with quotes where possible"),
  contactInstructions: z.string().nullable().describe("Exact posted rules for prospective students, quoted; null if none"),
  communicationStyle: z.string(),
  labCulture: z.string(),
  recentNews: z.array(z.string()).max(8),
  hooks: z.array(z.object({ point: z.string(), source: z.string() })).max(4),
  redFlags: z.array(z.string()).max(6),
  notTakingStudents: z.boolean().describe("true only with clear evidence they are not taking students now"),
  noColdEmails: z.boolean().describe("true if they explicitly ask prospective students not to email them"),
  sources: z.array(z.string()).max(30),
  currentEmail: z.string().nullable().describe("Their CURRENT official email if it differs from the one given (e.g. they moved); else null"),
  currentUniversity: z.string().nullable().describe("Their current university if they moved; else null"),
});

type Row = { p: typeof t.professors.$inferSelect; uni: string | null };

/** Shortlisted professors without a dossier, best first. */
export async function nextToResearch(inFlight: Set<number>, limit = 1): Promise<Row[]> {
  const rows = await db
    .select({ p: t.professors, uni: t.universities.name })
    .from(t.professors)
    .leftJoin(t.universities, eq(t.universities.id, t.professors.universityId))
    .where(and(eq(t.professors.status, "shortlisted"), isNull(t.professors.dossier)))
    .orderBy(desc(t.professors.priorityScore))
    .limit(limit + inFlight.size);
  return rows.filter((r) => !inFlight.has(r.p.id)).slice(0, limit);
}

/** Batch mode for `--stages research`. */
export async function deepResearch() {
  await pool(await nextToResearch(new Set(), cfg.nightlyEmailCap * 2), cfg.parallel, researchOne);
}

/** Builds a deep professional dossier for one shortlisted professor before any email is written. */
export async function researchOne({ p, uni }: Row) {
  const profile = applicantProfile();
  try {
    const d = await ask({
      system: `You are a meticulous academic researcher preparing a briefing on one professor's professional public record.\n\n${skill("researcher")}`,
      prompt: `Applicant (for finding hooks):\n${profile}\n\nProfessor: ${p.fullName}, ${p.title ?? ""} ${uni ? `at ${uni}` : ""} (${p.country ?? "?"}).\nEmail on file: ${p.email ?? "none"} (verify it is current) · Homepage: ${p.homepage ?? "unknown"} · Lab: ${p.labUrl ?? "unknown"} · Scholar: ${p.scholarUrl ?? "unknown"}\nWhat we know: ${p.summary ?? ""}\n${citationNote(p.fullName)}\nToday is ${new Date().toISOString().slice(0, 10)}.`,
      schema: DossierOut,
      tools: ["WebSearch", "WebFetch"],
      maxTurns: 45,
      effort: "high",
    });
    const blocked = d.notTakingStudents || d.noColdEmails;
    await db
      .update(t.professors)
      .set({
        dossier: { ...d, researchedAt: new Date().toISOString() },
        contactInstructions: d.contactInstructions,
        // People move; the dossier has the freshest official address.
        ...(d.currentEmail && /@/.test(d.currentEmail) && d.currentEmail.toLowerCase() !== p.email
          ? { email: d.currentEmail.toLowerCase(), notes: `Email updated from ${p.email} (moved${d.currentUniversity ? ` to ${d.currentUniversity}` : ""})` }
          : {}),
        ...(blocked
          ? { status: "skipped" as const, notes: d.noColdEmails ? `Asks not to be emailed: ${d.contactInstructions ?? ""}` : `Not taking students: ${d.redFlags.join("; ")}` }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(t.professors.id, p.id));
    bump("deep_researched");
    await log("profiler", `Dossier for ${p.fullName}: ${d.hooks.length} hooks, ${d.sources.length} sources${blocked ? " → skipped (" + (d.noColdEmails ? "no cold emails" : "not taking students") + ")" : ""}`, {
      professorId: p.id,
      level: blocked ? "warn" : "info",
    });
  } catch (e) {
    if (e instanceof UsageLimitError) throw e;
    await log("profiler", `Deep research failed for ${p.fullName}: ${(e as Error).message}`, { level: "warn", professorId: p.id });
  }
}
