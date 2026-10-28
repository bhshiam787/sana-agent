import Link from "next/link";
import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import { db, t } from "@/db";
import { setPositionStatus } from "@/lib/actions";
import { Empty, ExtLink, PageHeader } from "@/components/ui";
import { daysFromNow, fmtDate, isoDay, label } from "@/lib/format";

export default async function Positions(props: PageProps<"/positions">) {
  const sp = await props.searchParams;
  const status = typeof sp.status === "string" ? sp.status : "";
  const kind = typeof sp.kind === "string" ? sp.kind : "";
  const open = sp.open !== "all";

  const where: SQL[] = [];
  if (status) where.push(eq(t.positions.status, status as (typeof t.positionStatus.enumValues)[number]));
  if (kind) where.push(eq(t.positions.kind, kind));
  if (open) where.push(sql`(${t.positions.deadline} is null or ${t.positions.deadline} >= current_date)`);

  const rows = await db
    .select({ pos: t.positions, prof: t.professors.fullName, uni: t.universities.name })
    .from(t.positions)
    .leftJoin(t.professors, eq(t.professors.id, t.positions.professorId))
    .leftJoin(t.universities, eq(t.universities.id, t.positions.universityId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(sql`${t.positions.deadline} asc nulls last`, asc(t.positions.id))
    .limit(300);

  const soon = isoDay(daysFromNow(14));

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Positions & deadlines" sub="Funded PhD / masters posts and scholarships the agent found." />
      <form className="card mb-4 flex flex-wrap gap-2 p-3">
        <select name="status" defaultValue={status} className="input">
          <option value="">Any status</option>
          {t.positionStatus.enumValues.map((s) => (
            <option key={s} value={s}>{label(s)}</option>
          ))}
        </select>
        <select name="kind" defaultValue={kind} className="input">
          <option value="">Any type</option>
          {["phd", "masters", "scholarship", "ra"].map((k) => (
            <option key={k} value={k}>{k.toUpperCase()}</option>
          ))}
        </select>
        <select name="open" defaultValue={open ? "" : "all"} className="input">
          <option value="">Open deadlines only</option>
          <option value="all">Include past deadlines</option>
        </select>
        <button className="btn">Filter</button>
        <Link href="/positions" className="btn-ghost">Reset</Link>
      </form>

      <div className="card overflow-x-auto">
        {rows.length === 0 ? (
          <Empty>No positions yet.</Empty>
        ) : (
          <table className="w-full min-w-[900px]">
            <thead className="border-b border-line">
              <tr>
                <th className="th">Position</th>
                <th className="th">Where</th>
                <th className="th">Funding</th>
                <th className="th">Deadline</th>
                <th className="th">Source</th>
                <th className="th">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map(({ pos, prof, uni }) => (
                <tr key={pos.id} className="row-hover">
                  <td className="td">
                    <ExtLink href={pos.url}>{pos.title}</ExtLink>
                    <div className="text-xs text-muted">
                      {pos.kind.toUpperCase()}
                      {prof && pos.professorId && (
                        <> · <Link href={`/professors/${pos.professorId}`} className="hover:underline">{prof}</Link></>
                      )}
                    </div>
                  </td>
                  <td className="td">
                    <div>{uni ?? "—"}</div>
                    <div className="text-xs text-muted">{pos.country}</div>
                  </td>
                  <td className="td max-w-xs text-xs text-ink-2">{pos.funding}</td>
                  <td className={`td whitespace-nowrap ${pos.deadline && pos.deadline <= soon ? "font-medium text-critical" : ""}`}>
                    {fmtDate(pos.deadline)}
                    {pos.deadline && pos.deadline <= soon && <div className="text-xs">⚠ within 14 days</div>}
                  </td>
                  <td className="td text-xs">{pos.source}</td>
                  <td className="td">
                    <form action={setPositionStatus.bind(null, pos.id)} className="flex gap-1">
                      <select name="status" defaultValue={pos.status} className="input py-1 text-xs">
                        {t.positionStatus.enumValues.map((s) => (
                          <option key={s} value={s}>{label(s)}</option>
                        ))}
                      </select>
                      <button className="btn-ghost px-2 py-1 text-xs">Save</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
