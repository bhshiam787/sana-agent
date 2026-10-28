import { desc, eq } from "drizzle-orm";
import { db, t } from "@/db";
import { getSession } from "@/lib/session";

const csv = (v: unknown) => {
  const s = v == null ? "" : Array.isArray(v) ? v.join("; ") : v instanceof Date ? v.toISOString() : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET() {
  if (!(await getSession())) return new Response("Unauthorized", { status: 401 });
  const rows = await db
    .select({ p: t.professors, uni: t.universities.name })
    .from(t.professors)
    .leftJoin(t.universities, eq(t.universities.id, t.professors.universityId))
    .orderBy(desc(t.professors.priorityScore));
  const cols = ["fullName", "title", "department", "country", "email", "homepage", "labUrl", "scholarUrl", "linkedinUrl", "researchAreas", "recruiting", "fitScore", "fundingScore", "replyScore", "priorityScore", "status", "lastContactedAt", "notes"] as const;
  const lines = [["university", ...cols].join(",")];
  for (const { p, uni } of rows) lines.push([csv(uni), ...cols.map((c) => csv(p[c]))].join(","));
  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="professors-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
