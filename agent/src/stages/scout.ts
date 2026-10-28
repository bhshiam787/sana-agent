import { z } from "zod";
import { cfg } from "../config.ts";
import { db, t, eq, inArray } from "../db.ts";
import { ask } from "../llm.ts";
import { bump, log } from "../log.ts";
import { applicantProfile, skill, targets } from "../skills.ts";

const OA = "https://api.openalex.org";

async function openalex<T>(pathAndQuery: string): Promise<T> {
  const sep = pathAndQuery.includes("?") ? "&" : "?";
  const url = `${OA}${pathAndQuery}${cfg.openalexMailto ? `${sep}mailto=${encodeURIComponent(cfg.openalexMailto)}` : ""}`;
  const res = await fetch(url, { headers: { "User-Agent": "sana-agent (academic outreach research)" } });
  if (!res.ok) throw new Error(`OpenAlex ${res.status} for ${pathAndQuery}`);
  return res.json() as Promise<T>;
}

type OAWork = {
  authorships: { author_position: string; author: { id: string | null; display_name: string }; institutions: { id: string; display_name: string; country_code: string | null; type: string | null }[] }[];
};
type OAAuthor = {
  id: string;
  display_name: string;
  summary_stats?: { h_index?: number };
  works_count: number;
  last_known_institutions?: { id: string; display_name: string; country_code: string | null; type: string | null; ror?: string }[];
  topics?: { display_name: string }[];
};

async function upsertUniversity(name: string, country: string) {
  const [row] = await db
    .insert(t.universities)
    .values({ name, country })
    .onConflictDoUpdate({ target: [t.universities.name, t.universities.country], set: { name } })
    .returning({ id: t.universities.id });
  return row.id;
}

/** Senior (last) authors of recent papers on each research query become candidate professors. */
export async function scoutOpenAlex() {
  const tg = targets();
  const candidates = new Set<string>();
  for (const q of tg.researchQueries) {
    try {
      const data = await openalex<{ results: OAWork[] }>(
        `/works?search=${encodeURIComponent(q)}&filter=from_publication_date:${tg.publishedSince},type:article&sort=cited_by_count:desc&per-page=${Math.min(cfg.scoutPerQuery, 100)}`,
      );
      for (const w of data.results)
        for (const a of w.authorships)
          if (a.author?.id && a.author_position === "last" && a.institutions.some((i) => i.type === "education")) candidates.add(a.author.id);
    } catch (e) {
      await log("scout", `OpenAlex search failed for "${q}": ${(e as Error).message}`, { level: "warn" });
    }
  }
  if (!candidates.size) return;

  const ids = [...candidates].map((id) => id.replace("https://openalex.org/", ""));
  const known = new Set(
    (await db.select({ id: t.professors.openalexId }).from(t.professors).where(inArray(t.professors.openalexId, ids))).map((r) => r.id),
  );
  const fresh = ids.filter((id) => !known.has(id));
  let added = 0;
  for (let i = 0; i < fresh.length; i += 50) {
    const batch = fresh.slice(i, i + 50);
    const data = await openalex<{ results: OAAuthor[] }>(`/authors?filter=openalex:${batch.join("|")}&per-page=50`);
    for (const a of data.results) {
      const inst = a.last_known_institutions?.find((x) => x.type === "education");
      const h = a.summary_stats?.h_index ?? 0;
      if (!inst?.country_code || h < tg.minHIndex || h > tg.maxHIndex) continue;
      if (tg.excludeCountries.includes(inst.country_code)) continue;
      const universityId = await upsertUniversity(inst.display_name, inst.country_code);
      const inserted = await db
        .insert(t.professors)
        .values({
          fullName: a.display_name,
          universityId,
          country: inst.country_code,
          openalexId: a.id.replace("https://openalex.org/", ""),
          hIndex: h,
          researchAreas: (a.topics ?? []).slice(0, 5).map((x) => x.display_name),
          source: "openalex",
          sourceUrl: a.id,
        })
        .onConflictDoNothing()
        .returning({ id: t.professors.id });
      if (inserted.length) added++;
    }
  }
  bump("professors_found", added);
  await log("scout", `OpenAlex: ${candidates.size} senior authors seen, ${added} new professors added`);
}

const PositionsOut = z.object({
  positions: z.array(
    z.object({
      title: z.string(),
      kind: z.enum(["phd", "masters", "scholarship", "ra"]),
      university: z.string().nullable(),
      country: z.string().nullable().describe("ISO 3166-1 alpha-2 code"),
      professorName: z.string().nullable(),
      professorEmail: z.string().nullable(),
      funding: z.string().describe("What is funded: salary/stipend amount, tuition, insurance"),
      deadline: z.string().nullable().describe("YYYY-MM-DD or null if open until filled"),
      url: z.string(),
      source: z.string(),
    }),
  ),
  notes: z.string().describe("Problems met while searching, if any"),
});

/** Web search for currently open, funded positions. */
export async function scoutPositions() {
  const tg = targets();
  const out = await ask({
    system: `You find open, funded graduate positions for one applicant.\n\n${skill("scout")}`,
    prompt: `Applicant profile:\n${applicantProfile()}\n\nResearch areas to search: ${tg.researchQueries.join("; ")}.\nToday is ${new Date().toISOString().slice(0, 10)}.\n\nFind up to 15 currently open, funded PhD (or fully funded masters) positions that fit this applicant. Verify each by opening the posting. Return only positions with a working URL and future deadline (or open until filled).`,
    schema: PositionsOut,
    tools: ["WebSearch", "WebFetch"],
    maxTurns: 40,
  });
  await savePositions(out.positions, "web");
  if (out.notes) await log("scout", `Position search notes: ${out.notes}`);
}

export async function savePositions(list: z.infer<typeof PositionsOut>["positions"], via: string) {
  let added = 0;
  for (const p of list) {
    if (!/^https?:\/\//.test(p.url)) continue;
    const universityId = p.university && p.country ? await upsertUniversity(p.university, p.country) : null;
    let professorId: number | null = null;
    if (p.professorName) {
      const email = p.professorEmail?.toLowerCase() || null;
      const [existing] = email
        ? await db.select({ id: t.professors.id }).from(t.professors).where(eq(t.professors.email, email))
        : [];
      if (existing) professorId = existing.id;
      else {
        const [row] = await db
          .insert(t.professors)
          .values({
            fullName: p.professorName,
            universityId,
            country: p.country,
            email,
            recruiting: true,
            recruitingEvidence: `${p.title} (${p.url})`,
            source: p.source || via,
            sourceUrl: p.url,
          })
          .onConflictDoNothing()
          .returning({ id: t.professors.id });
        professorId = row?.id ?? null;
        if (row) bump("professors_found");
      }
    }
    const inserted = await db
      .insert(t.positions)
      .values({
        title: p.title,
        kind: p.kind,
        universityId,
        professorId,
        country: p.country,
        funding: p.funding,
        deadline: p.deadline && /^\d{4}-\d{2}-\d{2}$/.test(p.deadline) ? p.deadline : null,
        url: p.url,
        source: p.source || via,
      })
      .onConflictDoNothing()
      .returning({ id: t.positions.id });
    if (inserted.length) added++;
  }
  bump("positions_found", added);
  await log("scout", `${via}: ${list.length} positions returned, ${added} new saved`);
}

export { PositionsOut };

const LabsOut = z.object({
  professors: z.array(
    z.object({
      name: z.string(),
      university: z.string(),
      country: z.string().describe("ISO 3166-1 alpha-2 code"),
      email: z.string().nullable().describe("Only from an official page"),
      homepage: z.string().nullable(),
      evidence: z.string().describe("Quote showing they are recruiting, with date if shown"),
      evidenceUrl: z.string(),
    }),
  ),
});

/** Web search for lab pages that say they are recruiting PhD students now. */
export async function scoutRecruitingLabs() {
  const tg = targets();
  const out = await ask({
    system: `You find professors who are actively recruiting PhD students right now.\n\n${skill("scout")}`,
    prompt: `Applicant profile:\n${applicantProfile()}\n\nTopics: ${tg.researchQueries.join("; ")}.\nPrefer these countries (funded PhDs): ${tg.preferCountries.join(", ")}.\nToday is ${new Date().toISOString().slice(0, 10)}.\n\nSearch for lab / faculty pages (e.g. "prospective students", "open positions", "join our lab", "I am looking for PhD students") updated in the last 12 months for these topics. Return up to 20 professors with the quoted evidence and its URL. Only include evidence you actually opened.`,
    schema: LabsOut,
    tools: ["WebSearch", "WebFetch"],
    maxTurns: 40,
  });
  let added = 0;
  for (const p of out.professors) {
    const universityId = await upsertUniversity(p.university, p.country);
    const email = p.email?.toLowerCase() || null;
    const row = await db
      .insert(t.professors)
      .values({
        fullName: p.name,
        universityId,
        country: p.country,
        email,
        homepage: p.homepage,
        recruiting: true,
        recruitingEvidence: `${p.evidence} (${p.evidenceUrl})`,
        source: "lab-pages",
        sourceUrl: p.evidenceUrl,
      })
      .onConflictDoNothing()
      .returning({ id: t.professors.id });
    if (row.length) added++;
  }
  bump("professors_found", added);
  await log("scout", `Recruiting-lab search: ${out.professors.length} found, ${added} new`);
}
