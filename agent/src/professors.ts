import { db, t, and, eq, sql } from "./db.ts";
import { bump } from "./log.ts";
import { targets } from "./skills.ts";

export async function upsertUniversity(name: string, country: string, extra: { rank?: number; website?: string } = {}) {
  const [row] = await db
    .insert(t.universities)
    .values({ name, country, ...extra })
    .onConflictDoUpdate({ target: [t.universities.name, t.universities.country], set: { name } })
    .returning({ id: t.universities.id });
  return row.id;
}

export const countryAllowed = (cc: string | null | undefined) => {
  if (!cc) return false;
  const tg = targets();
  return tg.allowCountries.includes(cc) && !tg.excludeCountries.includes(cc);
};

const wealthyCache = new Map<number, boolean>();
export async function isWealthy(universityId: number) {
  if (!wealthyCache.has(universityId)) {
    const [u] = await db.select({ w: t.universities.wealthy }).from(t.universities).where(eq(t.universities.id, universityId));
    wealthyCache.set(universityId, u?.w ?? false);
  }
  return wealthyCache.get(universityId)!;
}

type NewProfessor = typeof t.professors.$inferInsert;

/**
 * Inserts a professor unless already known by OpenAlex id, email, or same
 * name at the same university. Returns the new id, or null for a duplicate.
 */
export async function addProfessor(p: NewProfessor): Promise<number | null> {
  if (!countryAllowed(p.country) && !(p.universityId && (await isWealthy(p.universityId)))) return null;
  const email = p.email?.trim().toLowerCase() || null;
  if (email) {
    const [dup] = await db.select({ id: t.professors.id }).from(t.professors).where(eq(t.professors.email, email)).limit(1);
    if (dup) return null;
  }
  if (p.universityId) {
    const [dup] = await db
      .select({ id: t.professors.id })
      .from(t.professors)
      .where(and(eq(t.professors.universityId, p.universityId), sql`lower(${t.professors.fullName}) = lower(${p.fullName})`))
      .limit(1);
    if (dup) return null;
  }
  const [row] = await db.insert(t.professors).values({ ...p, email }).onConflictDoNothing().returning({ id: t.professors.id });
  if (row) bump("professors_found");
  return row?.id ?? null;
}
