import { z } from "zod";
import { cfg } from "../config.ts";
import { db, t, eq, inArray } from "../db.ts";
import { ask, UsageLimitError } from "../llm.ts";
import { bump, log } from "../log.ts";
import { addProfessor, countryAllowed, upsertUniversity } from "../professors.ts";
import { applicantProfile, skill, targets } from "../skills.ts";

const OA = "https://api.openalex.org";
const today = () => new Date().toISOString().slice(0, 10);

export async function openalex<T>(pathAndQuery: string): Promise<T> {
  const params = new URLSearchParams();
  if (cfg.openalexApiKey) params.set("api_key", cfg.openalexApiKey);
  else if (cfg.openalexMailto) params.set("mailto", cfg.openalexMailto);
  const sep = pathAndQuery.includes("?") ? "&" : "?";
  const url = `${OA}${pathAndQuery}${params.size ? sep + params : ""}`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": "sana-agent (academic outreach research)" } });
    if (res.ok) return res.json() as Promise<T>;
    // 429 = rate/budget limit: back off a few times (set OPENALEX_API_KEY to avoid it).
    if (res.status === 429 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 5000 * 2 ** attempt));
      continue;
    }
    throw new Error(`OpenAlex ${res.status} for ${pathAndQuery}`);
  }
}

type OAWork = {
  authorships: { author_position: string; author: { id: string | null; display_name: string }; institutions: { country_code: string | null; type: string | null }[] }[];
};
type OAAuthor = {
  id: string;
  display_name: string;
  summary_stats?: { h_index?: number };
  last_known_institutions?: { display_name: string; country_code: string | null; type: string | null }[];
  topics?: { display_name: string }[];
};

/** Senior (last) authors of recent papers on each research topic, in allowed countries. */
export async function scoutOpenAlex() {
  const tg = targets();
  const countries = tg.allowCountries.filter(countryAllowed).join("|");
  const candidates = new Set<string>();
  await Promise.all(
    tg.researchQueries.map(async (q) => {
      try {
        const data = await openalex<{ results: OAWork[] }>(
          `/works?search=${encodeURIComponent(q)}&filter=from_publication_date:${tg.publishedSince},type:article,institutions.country_code:${countries}&sort=cited_by_count:desc&per-page=${Math.min(cfg.scoutPerQuery, 100)}`,
        );
        for (const w of data.results)
          for (const a of w.authorships)
            if (a.author?.id && a.author_position === "last" && a.institutions.some((i) => i.type === "education" && countryAllowed(i.country_code)))
              candidates.add(a.author.id);
      } catch (e) {
        await log("scout", `OpenAlex search failed for "${q}": ${(e as Error).message}`, { level: "warn" });
      }
    }),
  );
  if (!candidates.size) return;

  const ids = [...candidates].map((id) => id.replace("https://openalex.org/", ""));
  const known = new Set((await db.select({ id: t.professors.openalexId }).from(t.professors).where(inArray(t.professors.openalexId, ids))).map((r) => r.id));
  const fresh = ids.filter((id) => !known.has(id));
  let added = 0;
  for (let i = 0; i < fresh.length; i += 50) {
    const data = await openalex<{ results: OAAuthor[] }>(`/authors?filter=openalex:${fresh.slice(i, i + 50).join("|")}&per-page=50`);
    for (const a of data.results) {
      const inst = a.last_known_institutions?.find((x) => x.type === "education" && countryAllowed(x.country_code));
      const h = a.summary_stats?.h_index ?? 0;
      if (!inst?.country_code || h < tg.minHIndex || h > tg.maxHIndex) continue;
      const id = await addProfessor({
        fullName: a.display_name,
        universityId: await upsertUniversity(inst.display_name, inst.country_code),
        country: inst.country_code,
        openalexId: a.id.replace("https://openalex.org/", ""),
        hIndex: h,
        researchAreas: (a.topics ?? []).slice(0, 5).map((x) => x.display_name),
        source: "openalex",
        sourceUrl: a.id,
      });
      if (id) added++;
    }
  }
  await log("scout", `OpenAlex: ${candidates.size} senior authors seen, ${added} new professors`);
}

export const PositionsOut = z.object({
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

/** Track A: advertised funded positions ("circulars"), one Claude session per topic, in parallel. */
export async function scoutPositions() {
  const tg = targets();
  const profile = applicantProfile();
  await Promise.all(
    tg.researchQueries.map(async (topic) => {
      try {
        const out = await ask({
          system: `You find open, funded graduate positions for one applicant.\n\n${skill("scout")}`,
          prompt: `Applicant profile:\n${profile}\n\nTopic: ${topic}\nAllowed countries (ISO): ${tg.allowCountries.join(", ")}.\nToday is ${today()}.\n\nFind up to 10 currently open, funded PhD (or fully funded masters) positions on this topic in the allowed countries. Check job boards (EURAXESS, university portals, Varbi, AcademicTransfer, Jobbnorge, FindAPhD, jobs.ac.uk, AcademicPositions) and professors' own posts. Verify each by opening the posting. Only working URLs with a future deadline (or open until filled).`,
          schema: PositionsOut,
          tools: ["WebSearch", "WebFetch"],
          maxTurns: 35,
        });
        await savePositions(out.positions, `web: ${topic}`);
      } catch (e) {
        if (e instanceof UsageLimitError) throw e;
        await log("scout", `Position search "${topic}" failed: ${(e as Error).message}`, { level: "warn" });
      }
    }),
  );
}

export async function savePositions(list: z.infer<typeof PositionsOut>["positions"], via: string) {
  let added = 0;
  for (const p of list) {
    if (!/^https?:\/\//.test(p.url) || (p.country && !countryAllowed(p.country))) continue;
    const universityId = p.university && p.country ? await upsertUniversity(p.university, p.country) : null;
    let professorId: number | null = null;
    if (p.professorName) {
      const email = p.professorEmail?.toLowerCase() || null;
      professorId =
        (await addProfessor({
          fullName: p.professorName,
          universityId,
          country: p.country,
          email,
          recruiting: true,
          recruitingEvidence: `${p.title} (${p.url})`,
          source: p.source || via,
          sourceUrl: p.url,
        })) ?? (email ? ((await db.select({ id: t.professors.id }).from(t.professors).where(eq(t.professors.email, email)))[0]?.id ?? null) : null);
      if (professorId) await db.update(t.professors).set({ recruiting: true }).where(eq(t.professors.id, professorId));
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
  await log("scout", `${via}: ${list.length} positions returned, ${added} new`);
}

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

/** Track A: lab pages that say "we are recruiting", one session per country, in parallel. */
export async function scoutRecruitingLabs() {
  const tg = targets();
  const profile = applicantProfile();
  await Promise.all(
    tg.preferCountries.filter(countryAllowed).map(async (cc) => {
      try {
        const out = await ask({
          system: `You find professors who are actively recruiting PhD students right now.\n\n${skill("scout")}`,
          prompt: `Applicant profile:\n${profile}\n\nCountry: ${cc}. Topics: ${tg.researchQueries.join("; ")}.\nToday is ${today()}.\n\nFind lab / faculty pages in this country ("prospective students", "open positions", "join our lab", "I am looking for PhD students") updated in the last 12 months on these topics. Return up to 10 professors with quoted evidence and its URL. Only evidence you opened.`,
          schema: LabsOut,
          tools: ["WebSearch", "WebFetch"],
          maxTurns: 30,
        });
        let added = 0;
        for (const p of out.professors) {
          const id = await addProfessor({
            fullName: p.name,
            universityId: await upsertUniversity(p.university, p.country),
            country: p.country,
            email: p.email,
            homepage: p.homepage,
            recruiting: true,
            recruitingEvidence: `${p.evidence} (${p.evidenceUrl})`,
            source: "lab-pages",
            sourceUrl: p.evidenceUrl,
          });
          if (id) added++;
        }
        await log("scout", `Recruiting labs ${cc}: ${out.professors.length} found, ${added} new`);
      } catch (e) {
        if (e instanceof UsageLimitError) throw e;
        await log("scout", `Recruiting-lab search ${cc} failed: ${(e as Error).message}`, { level: "warn" });
      }
    }),
  );
}
