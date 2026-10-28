import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db, t } from "@/db";
import { Chip, Empty } from "@/components/ui";
import { fmtDate, label } from "@/lib/format";

export default async function RunPage(props: PageProps<"/runs/[id]">) {
  const id = Number((await props.params).id);
  if (!Number.isInteger(id)) notFound();
  const [[row], log] = await Promise.all([
    db
      .select({ run: t.agentRuns, by: t.users.name })
      .from(t.agentRuns)
      .leftJoin(t.users, eq(t.users.id, t.agentRuns.startedBy))
      .where(eq(t.agentRuns.id, id)),
    db
      .select({ a: t.activity, prof: t.professors.fullName })
      .from(t.activity)
      .leftJoin(t.professors, eq(t.professors.id, t.activity.professorId))
      .where(eq(t.activity.runId, id))
      .orderBy(asc(t.activity.at)),
  ]);
  if (!row) notFound();
  const { run, by } = row;

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/runs" className="text-sm text-muted hover:text-ink">← Runs</Link>
      <div className="mt-2 mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Run #{run.id}</h1>
        <Chip status={run.status} />
        <span className="text-sm text-ink-2">
          {run.dryRun ? "Dry run" : "Live"} · started {fmtDate(run.startedAt, true)} by {by ?? "—"}
          {run.endedAt && ` · ended ${fmtDate(run.endedAt, true)}`}
        </span>
      </div>
      {run.summary && <div className="card mb-4 p-4 text-sm whitespace-pre-line">{run.summary}</div>}
      {run.error && <div className="card mb-4 border-critical/40 p-4 text-sm text-critical">{run.error}</div>}
      {run.stats && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {Object.entries(run.stats).map(([k, v]) => (
            <div key={k} className="card p-3">
              <div className="text-xs text-muted">{label(k)}</div>
              <div className="text-xl font-semibold tabular-nums">{v}</div>
            </div>
          ))}
        </div>
      )}
      <section className="card">
        <h2 className="border-b border-line px-4 py-3 font-medium">Activity log</h2>
        {log.length === 0 ? (
          <Empty>No activity logged.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {log.map(({ a, prof }) => (
              <li key={a.id} className="flex gap-3 px-4 py-2 text-sm">
                <span className="w-16 shrink-0 text-xs text-muted tabular-nums">
                  {new Date(a.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="w-20 shrink-0 text-xs text-muted">{a.agent}</span>
                <span className={a.level === "error" ? "text-critical" : a.level === "warn" ? "text-ink" : "text-ink-2"}>
                  {a.level !== "info" && <strong>{a.level.toUpperCase()}: </strong>}
                  {a.message}
                  {prof && a.professorId && (
                    <> · <Link href={`/professors/${a.professorId}`} className="text-accent hover:underline">{prof}</Link></>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
