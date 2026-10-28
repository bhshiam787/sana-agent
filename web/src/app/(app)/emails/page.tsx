import Link from "next/link";
import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { db, t } from "@/db";
import { Chip, Empty, PageHeader } from "@/components/ui";
import { fmtDate, label, score } from "@/lib/format";

export default async function Emails(props: PageProps<"/emails">) {
  const sp = await props.searchParams;
  const p = (k: string) => (typeof sp[k] === "string" && sp[k] ? (sp[k] as string) : undefined);
  const status = p("status");
  const kind = p("kind");
  const from = p("from");
  const to = p("to");

  const where: SQL[] = [];
  if (status) where.push(eq(t.emails.status, status as (typeof t.emailStatus.enumValues)[number]));
  if (kind) where.push(eq(t.emails.kind, kind));
  if (from) where.push(gte(sql`coalesce(${t.emails.sentAt}, ${t.emails.createdAt})`, new Date(from)));
  if (to) where.push(lte(sql`coalesce(${t.emails.sentAt}, ${t.emails.createdAt})`, new Date(`${to}T23:59:59`)));

  const rows = await db
    .select({
      e: t.emails,
      prof: t.professors.fullName,
      replied: sql<boolean>`exists (select 1 from replies r where r.email_id = ${t.emails.id})`,
    })
    .from(t.emails)
    .innerJoin(t.professors, eq(t.professors.id, t.emails.professorId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(sql`coalesce(${t.emails.sentAt}, ${t.emails.createdAt})`))
    .limit(300);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Emails sent" sub="Every email the agent wrote, including ones the reviewer blocked." />
      <form className="card mb-4 flex flex-wrap items-center gap-2 p-3">
        <select name="status" defaultValue={status ?? ""} className="input">
          <option value="">Any status</option>
          {t.emailStatus.enumValues.map((s) => (
            <option key={s} value={s}>{label(s)}</option>
          ))}
        </select>
        <select name="kind" defaultValue={kind ?? ""} className="input">
          <option value="">Initial + follow-up</option>
          <option value="initial">Initial</option>
          <option value="follow_up">Follow-up</option>
        </select>
        <input type="date" name="from" defaultValue={from} className="input" />
        <span className="text-muted">–</span>
        <input type="date" name="to" defaultValue={to} className="input" />
        <button className="btn">Filter</button>
        <Link href="/emails" className="btn-ghost">Reset</Link>
      </form>

      <div className="card overflow-x-auto">
        {rows.length === 0 ? (
          <Empty>No emails yet.</Empty>
        ) : (
          <table className="w-full min-w-[800px]">
            <thead className="border-b border-line">
              <tr>
                <th className="th">Date</th>
                <th className="th">To</th>
                <th className="th">Subject</th>
                <th className="th">Type</th>
                <th className="th text-right">Review</th>
                <th className="th">Status</th>
                <th className="th">Replied</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map(({ e, prof, replied }) => (
                <tr key={e.id} className="row-hover">
                  <td className="td whitespace-nowrap text-xs">{fmtDate(e.sentAt ?? e.createdAt, true)}</td>
                  <td className="td">
                    <Link href={`/professors/${e.professorId}`} className="hover:underline">{prof}</Link>
                    <div className="text-xs text-muted">{e.toAddress}</div>
                  </td>
                  <td className="td">
                    <details>
                      <summary className="cursor-pointer">{e.subject}</summary>
                      <pre className="mt-2 max-w-2xl font-sans text-sm whitespace-pre-wrap text-ink-2">{e.body}</pre>
                      {e.reviewNotes && <p className="mt-2 text-xs text-muted">Reviewer: {e.reviewNotes}</p>}
                    </details>
                  </td>
                  <td className="td text-xs">{label(e.kind)}</td>
                  <td className="td text-right tabular-nums">{score(e.reviewScore)}</td>
                  <td className="td"><Chip status={e.status} /></td>
                  <td className="td text-sm">{replied ? "Yes" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
