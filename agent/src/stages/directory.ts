import { z } from "zod";
import { db, t, and, asc, desc, eq, isNull, sql } from "../db.ts";
import { ask, UsageLimitError } from "../llm.ts";
import { bump, log } from "../log.ts";
import { addProfessor, countryAllowed, upsertUniversity } from "../professors.ts";
import { applicantProfile, targets } from "../skills.ts";
import { openalex } from "./scout.ts";

type OAInst = { display_name: string; country_code: string; homepage_url: string | null };

async function markWealthy(name: string, country: string, website: string | null) {
  await upsertUniversity(name, country);
  await db
    .update(t.universities)
    .set({ wealthy: true, rank: 0, ...(website ? { website } : {}) })
    .where(and(eq(t.universities.name, name), eq(t.universities.country, country)));
}

/** Adds the top research universities of every allowed country (by OpenAlex output). Cheap, no Claude. */
export async function seedUniversities() {
  const tg = targets();
  let n = 0;
  // Well-funded universities first, matched to OpenAlex's spelling of the name.
  for (const w of tg.wealthyUniversities) {
    try {
      const data = await openalex<{ results: OAInst[] }>(
        `/institutions?search=${encodeURIComponent(w.name)}&filter=country_code:${w.country}&per-page=1&select=display_name,country_code,homepage_url`,
      );
      await markWealthy(data.results[0]?.display_name ?? w.name, w.country, data.results[0]?.homepage_url ?? null);
    } catch {
      // Lookup failed (e.g. OpenAlex limit): keep the list's own spelling.
      await markWealthy(w.name, w.country, null);
    }
  }
  for (const cc of tg.allowCountries.filter(countryAllowed)) {
    try {
      const data = await openalex<{ results: OAInst[] }>(
        `/institutions?filter=country_code:${cc},type:education&sort=works_count:desc&per-page=${tg.universitiesPerCountry}&select=display_name,country_code,homepage_url`,
      );
      for (const [i, u] of data.results.entries()) {
        await upsertUniversity(u.display_name, cc);
        await db
          .update(t.universities)
          .set({ rank: i + 1, website: u.homepage_url })
          .where(and(eq(t.universities.name, u.display_name), eq(t.universities.country, cc), isNull(t.universities.rank)));
        n++;
      }
    } catch (e) {
      await log("scout", `University list for ${cc} failed: ${(e as Error).message}`, { level: "warn" });
    }
  }
  await log("scout", `University list ready (${n} checked across ${tg.allowCountries.length} countries)`);
}

/** Next university to sweep: preferred countries first, then by rank. */
export async function nextUniversity(inFlight: Set<number>) {
  const prefer = targets().preferCountries;
  const rows = await db
    .select()
    .from(t.universities)
    .where(and(isNull(t.universities.sweptAt), sql`${t.universities.rank} is not null`))
    .orderBy(
      desc(t.universities.wealthy),
      sql`array_position(${sql.raw(`ARRAY[${prefer.map((c) => `'${c.replace(/[^A-Z]/g, "")}'`).join(",") || "''"}]::text[]`)}, ${t.universities.country}) asc nulls last`,
      asc(t.universities.rank),
    )
    .limit(inFlight.size + 1);
  return rows.find((r) => !inFlight.has(r.id)) ?? null;
}

const FacultyOut = z.object({
  departmentUrls: z.array(z.string()).describe("Faculty directory pages you used"),
  faculty: z.array(
    z.object({
      name: z.string(),
      title: z.string().nullable(),
      department: z.string().nullable(),
      email: z.string().nullable().describe("Only if shown on an official page"),
      homepage: z.string().nullable(),
      relevance: z.string().describe("Why their research matches the applicant's topics, one sentence"),
      fundingSignal: z.string().nullable().describe("Any sign they can fund a student (new hire, new grant, growing lab, 'looking for students'); null if none seen"),
    }),
  ),
  notes: z.string(),
});

/**
 * Track B (silent funding): walks one university's faculty directories and
 * returns the people whose research matches, even if they never advertise.
 */
export async function sweepUniversity(u: typeof t.universities.$inferSelect) {
  const tg = targets();
  try {
    const out = await ask({
      tier: "bulk",
      system:
        "You read university faculty directories to find professors whose research matches a graduate applicant. Use only official university pages for names, titles and emails. Do not guess emails.",
      prompt: `Applicant profile:\n${applicantProfile()}\n\nUniversity: ${u.name} (${u.country})${u.website ? `, ${u.website}` : ""}.\nDepartments to check: ${tg.departments.join(", ")}.\nApplicant topics: ${tg.researchQueries.join("; ")}.\n\nOpen the faculty / people directories of these departments. Return every professor or lecturer (not postdocs or students) whose research clearly matches one of the topics — typically 3–15 people. Note any funding signal you notice (recently hired, new grant, lab expanding, "looking for students").`,
      schema: FacultyOut,
      tools: ["WebSearch", "WebFetch"],
      maxTurns: 40,
    });
    let added = 0;
    for (const f of out.faculty) {
      const id = await addProfessor({
        fullName: f.name,
        title: f.title,
        department: f.department,
        universityId: u.id,
        country: u.country,
        email: f.email,
        homepage: f.homepage,
        whyMatch: f.relevance,
        recruitingEvidence: f.fundingSignal,
        source: "directory",
        sourceUrl: out.departmentUrls[0] ?? u.website,
      });
      if (id) added++;
    }
    await db.update(t.universities).set({ sweptAt: new Date(), sweepNotes: `${out.faculty.length} matching, ${added} new. ${out.notes}`.slice(0, 1000) }).where(eq(t.universities.id, u.id));
    bump("universities_swept");
    await log("scout", `Swept ${u.name} (${u.country}): ${out.faculty.length} matching faculty, ${added} new`);
  } catch (e) {
    if (e instanceof UsageLimitError) throw e;
    await db.update(t.universities).set({ sweptAt: new Date(), sweepNotes: `Failed: ${(e as Error).message}`.slice(0, 500) }).where(eq(t.universities.id, u.id));
    await log("scout", `Sweep of ${u.name} failed: ${(e as Error).message}`, { level: "warn" });
  }
}
