import Form from "next/form";
import Link from "next/link";
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { db, t } from "@/db";
import { Chip, Empty, PageHeader, withParams } from "@/components/ui";
import { fmtDate, label, score } from "@/lib/format";
import { SubmitButton } from "@/components/submit-button";

const PAGE = 50;
const SORTS = {
  priority: desc(t.professors.priorityScore),
  fit: desc(t.professors.fitScore),
  funding: desc(t.professors.fundingScore),
  newest: desc(t.professors.createdAt),
  contacted: desc(t.professors.lastContactedAt),
  name: asc(t.professors.fullName),
} as const;

export default async function Professors(props: PageProps<"/professors">) {
  const sp = await props.searchParams;
  const p = (k: string) => (typeof sp[k] === "string" && sp[k] ? (sp[k] as string) : undefined);
  const f = {
    q: p("q"),
    status: p("status"),
    stage: p("stage"),
    country: p("country"),
    recruiting: p("recruiting"),
    minFit: p("minFit"),
    from: p("from"),
    to: p("to"),
    sort: p("sort") ?? "priority",
    page: p("page"),
  };
  const page = Math.max(1, Number(f.page ?? 1));

  const where: SQL[] = [];
  if (f.q) {
    const like = `%${f.q}%`;
    where.push(
      or(
        ilike(t.professors.fullName, like),
        ilike(t.professors.department, like),
        ilike(t.universities.name, like),
        sql`array_to_string(${t.professors.researchAreas}, ' ') ilike ${like}`,
      )!,
    );
  }
  if (f.status) where.push(eq(t.professors.status, f.status as (typeof t.professorStatus.enumValues)[number]));
  // Pipeline links: "at or past" a stage, the same way the Overview pipeline counts.
  const STAGES = ["shortlisted", "emailed", "replied", "positive", "interview", "offer"] as const;
  if (f.stage && (STAGES as readonly string[]).includes(f.stage)) {
    const from = STAGES.indexOf(f.stage as (typeof STAGES)[number]);
    const later = STAGES.slice(from) as string[];
    if (f.stage === "shortlisted" || f.stage === "emailed") later.push("followed_up");
    where.push(inArray(t.professors.status, later as (typeof t.professorStatus.enumValues)[number][]));
  }
  if (f.country) where.push(eq(t.professors.country, f.country));
  if (f.recruiting === "yes") where.push(eq(t.professors.recruiting, true));
  if (f.minFit) where.push(gte(t.professors.fitScore, Number(f.minFit)));
  if (f.from) where.push(gte(t.professors.lastContactedAt, new Date(f.from)));
  if (f.to) where.push(lte(t.professors.lastContactedAt, new Date(`${f.to}T23:59:59`)));
  const cond = where.length ? and(...where) : undefined;

  const [rows, [{ total }], countries] = await Promise.all([
    db
      .select({ p: t.professors, uni: t.universities.name })
      .from(t.professors)
      .leftJoin(t.universities, eq(t.universities.id, t.professors.universityId))
      .where(cond)
      .orderBy(sql`${SORTS[f.sort as keyof typeof SORTS] ?? SORTS.priority} nulls last`, asc(t.professors.id))
      .limit(PAGE)
      .offset((page - 1) * PAGE),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(t.professors)
      .leftJoin(t.universities, eq(t.universities.id, t.professors.universityId))
      .where(cond),
    db.selectDistinct({ c: t.professors.country }).from(t.professors).where(sql`${t.professors.country} is not null`).orderBy(t.professors.country),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Professors" sub={`${total} matching`}>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- file download from a route handler */}
        <a href="/professors/export" className="btn-ghost">
          Export all (CSV)
        </a>
      </PageHeader>

      <Form action="/professors" className="card mb-4 grid grid-cols-2 gap-2 p-3 md:grid-cols-4 lg:grid-cols-8">
        <input name="q" defaultValue={f.q} placeholder="Name, university, topic…" className="input col-span-2" />
        <select name="status" defaultValue={f.status ?? ""} className="input">
          <option value="">Any status</option>
          {t.professorStatus.enumValues.map((s) => (
            <option key={s} value={s}>
              {label(s)}
            </option>
          ))}
        </select>
        <select name="country" defaultValue={f.country ?? ""} className="input">
          <option value="">Any country</option>
          {countries.map(({ c }) => (
            <option key={c} value={c!}>
              {c}
            </option>
          ))}
        </select>
        <select name="minFit" defaultValue={f.minFit ?? ""} className="input">
          <option value="">Any fit</option>
          <option value="80">Fit ≥ 80</option>
          <option value="60">Fit ≥ 60</option>
          <option value="40">Fit ≥ 40</option>
        </select>
        <select name="sort" defaultValue={f.sort} className="input">
          {Object.keys(SORTS).map((s) => (
            <option key={s} value={s}>
              Sort: {label(s)}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" name="recruiting" value="yes" defaultChecked={f.recruiting === "yes"} /> Recruiting
        </label>
        <div className="col-span-2 flex items-center gap-2 text-sm text-muted md:col-span-2">
          Contacted
          <input type="date" name="from" defaultValue={f.from} className="input min-w-0 flex-1" />–
          <input type="date" name="to" defaultValue={f.to} className="input min-w-0 flex-1" />
        </div>
        <div className="flex gap-2">
          <SubmitButton className="btn flex-1" pendingText="Filtering…">Filter</SubmitButton>
          <Link href="/professors" className="btn-ghost">
            Reset
          </Link>
        </div>
      </Form>

      <div className="card overflow-x-auto">
        {rows.length === 0 ? (
          <Empty>No professors match. The agent adds them as it runs.</Empty>
        ) : (
          <table className="w-full min-w-[900px]">
            <thead className="border-b border-line">
              <tr>
                <th className="th">Professor</th>
                <th className="th">University</th>
                <th className="th">Research</th>
                <th className="th text-right">Priority</th>
                <th className="th text-right">Fit</th>
                <th className="th text-right">Funding</th>
                <th className="th">Status</th>
                <th className="th">Contacted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map(({ p, uni }) => (
                <tr key={p.id} className="row-hover">
                  <td className="td">
                    <Link href={`/professors/${p.id}`} className="font-medium hover:underline">
                      {p.fullName}
                    </Link>
                    <div className="text-xs text-muted">
                      {p.title ?? ""}
                      {p.recruiting && <span className="ml-1 text-good">● recruiting</span>}
                    </div>
                  </td>
                  <td className="td">
                    <div>{uni ?? "—"}</div>
                    <div className="text-xs text-muted">{p.country}</div>
                  </td>
                  <td className="td max-w-xs text-xs text-ink-2">{(p.researchAreas ?? []).slice(0, 3).join(" · ")}</td>
                  <td className="td text-right font-medium tabular-nums">{score(p.priorityScore)}</td>
                  <td className="td text-right tabular-nums">{score(p.fitScore)}</td>
                  <td className="td text-right tabular-nums">{score(p.fundingScore)}</td>
                  <td className="td">
                    <Chip status={p.status} />
                  </td>
                  <td className="td text-xs text-ink-2">{fmtDate(p.lastContactedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          {page > 1 && (
            <Link className="btn-ghost" href={withParams("/professors", f, { page: String(page - 1) })}>
              ← Prev
            </Link>
          )}
          <span className="text-muted">
            Page {page} of {pages}
          </span>
          {page < pages && (
            <Link className="btn-ghost" href={withParams("/professors", f, { page: String(page + 1) })}>
              Next →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
