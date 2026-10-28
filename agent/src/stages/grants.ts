import { db, t, eq } from "../db.ts";
import { log } from "../log.ts";
import { addProfessor, upsertUniversity } from "../professors.ts";
import { targets } from "../skills.ts";

type NsfAward = {
  id: string;
  title: string;
  abstractText?: string;
  pdPIName: string;
  piEmail?: string;
  awardeeName: string;
  startDate: string;
  expDate: string;
  estimatedTotalAmt?: string;
};

const mdy = (s: string) => {
  const [m, d, y] = s.split("/");
  return `${y}-${m}-${d}`;
};

/**
 * Track B (silent funding): US PIs holding active NSF grants on her topics.
 * A grant that runs for years usually pays PhD students, even with no job ad.
 */
export async function scoutNsfGrants() {
  const tg = targets();
  if (!tg.allowCountries.includes("US")) return;
  const since = new Date(Date.now() - 2 * 365 * 86400000);
  const dateStart = `${String(since.getMonth() + 1).padStart(2, "0")}/01/${since.getFullYear()}`;
  let added = 0;
  let grants = 0;
  for (const q of tg.grantKeywords) {
    const url = `https://api.nsf.gov/services/v1/awards.json?keyword=${encodeURIComponent(`"${q}"`)}&dateStart=${dateStart}&printFields=id,title,abstractText,pdPIName,piEmail,awardeeName,startDate,expDate,estimatedTotalAmt&rpp=50`;
    try {
      const res = await fetch(url);
      const data = (await res.json()) as { response?: { award?: NsfAward[] } };
      // NSF matches loosely; keep awards whose title or abstract contains the keyword.
      for (const a of data.response?.award ?? []) {
        if (!`${a.title} ${a.abstractText ?? ""}`.toLowerCase().includes(q.toLowerCase())) continue;
        if (!a.piEmail || new Date(mdy(a.expDate)) < new Date()) continue;
        const universityId = await upsertUniversity(a.awardeeName, "US");
        const email = a.piEmail.toLowerCase();
        const newId = await addProfessor({
          fullName: a.pdPIName,
          universityId,
          country: "US",
          email,
          source: "nsf-grant",
          sourceUrl: `https://www.nsf.gov/awardsearch/showAward?AWD_ID=${a.id}`,
        });
        if (newId) added++;
        const [prof] = await db.select({ id: t.professors.id }).from(t.professors).where(eq(t.professors.email, email));
        if (prof) {
          await db
            .insert(t.grants)
            .values({
              professorId: prof.id,
              funder: "NSF",
              title: a.title,
              amount: a.estimatedTotalAmt ? Number(a.estimatedTotalAmt) : null,
              currency: "USD",
              startDate: mdy(a.startDate),
              endDate: mdy(a.expDate),
              url: `https://www.nsf.gov/awardsearch/showAward?AWD_ID=${a.id}`,
            })
            .onConflictDoNothing();
          grants++;
        }
      }
    } catch (e) {
      await log("scout", `NSF search "${q}" failed: ${(e as Error).message}`, { level: "warn" });
    }
  }
  await log("scout", `NSF grants: ${grants} active grants matched, ${added} new professors`);
}
