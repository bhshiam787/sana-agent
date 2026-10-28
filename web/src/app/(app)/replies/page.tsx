import Link from "next/link";
import { and, desc, eq, inArray, type SQL } from "drizzle-orm";
import { db, t } from "@/db";
import { toggleReplyHandled } from "@/lib/actions";
import { Chip, Empty, PageHeader } from "@/components/ui";
import { fmtDate, label } from "@/lib/format";

const GOOD = ["positive", "ask_cv", "apply_formally"] as const;

export default async function Replies(props: PageProps<"/replies">) {
  const sp = await props.searchParams;
  const cls = typeof sp.class === "string" ? sp.class : "";
  const handled = typeof sp.handled === "string" ? sp.handled : "";

  const where: SQL[] = [];
  if (cls === "positive") where.push(inArray(t.replies.classification, [...GOOD]));
  else if (cls) where.push(eq(t.replies.classification, cls as (typeof t.replyClass.enumValues)[number]));
  if (handled) where.push(eq(t.replies.handled, handled === "yes"));

  const rows = await db
    .select({ r: t.replies, prof: t.professors.fullName, uni: t.universities.name })
    .from(t.replies)
    .innerJoin(t.professors, eq(t.professors.id, t.replies.professorId))
    .leftJoin(t.universities, eq(t.universities.id, t.professors.universityId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(t.replies.receivedAt))
    .limit(200);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Replies" sub="Professor replies, sorted by the agent. Mark them handled once you've acted." />
      <form className="card mb-4 flex flex-wrap gap-2 p-3">
        <select name="class" defaultValue={cls} className="input">
          <option value="">All replies</option>
          <option value="positive">Good news (positive / CV / apply)</option>
          {t.replyClass.enumValues.map((c) => (
            <option key={c} value={c}>{label(c)}</option>
          ))}
        </select>
        <select name="handled" defaultValue={handled} className="input">
          <option value="">Handled or not</option>
          <option value="no">Needs action</option>
          <option value="yes">Handled</option>
        </select>
        <button className="btn">Filter</button>
        <Link href="/replies" className="btn-ghost">Reset</Link>
      </form>

      {rows.length === 0 ? (
        <div className="card"><Empty>No replies yet.</Empty></div>
      ) : (
        <ul className="space-y-3">
          {rows.map(({ r, prof, uni }) => (
            <li key={r.id} className={`card p-4 transition-colors hover:border-hover-line ${r.handled ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/professors/${r.professorId}`} className="font-medium hover:underline">{prof}</Link>
                <span className="text-sm text-muted">{uni}</span>
                <Chip status={r.classification} />
                <span className="ml-auto text-xs text-muted">{fmtDate(r.receivedAt, true)}</span>
              </div>
              <details className="mt-2">
                <summary className="cursor-pointer text-sm text-ink-2">{r.snippet}</summary>
                <pre className="mt-2 font-sans text-sm whitespace-pre-wrap text-ink-2">{r.body}</pre>
              </details>
              {r.suggestedAction && (
                <p className="mt-2 text-sm"><span className="font-medium">Suggested next step:</span> {r.suggestedAction}</p>
              )}
              <form action={toggleReplyHandled.bind(null, r.id, !r.handled)} className="mt-3">
                <button className="btn-ghost text-xs">{r.handled ? "Mark as needing action" : "Mark handled"}</button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
