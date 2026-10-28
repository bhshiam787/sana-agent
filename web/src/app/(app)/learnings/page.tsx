import { desc } from "drizzle-orm";
import { db, t } from "@/db";
import { decideLearning } from "@/lib/actions";
import { Chip, Empty, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/format";

export default async function Learnings() {
  const rows = await db.select().from(t.learnings).orderBy(desc(t.learnings.createdAt)).limit(200);
  const pending = rows.filter((r) => r.status === "proposed");
  const done = rows.filter((r) => r.status !== "proposed");

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Learnings"
        sub="What the agent learned while working. Approved learnings are written into its playbooks on the next run."
      />
      <h2 className="mb-2 text-sm font-medium text-muted">Waiting for you ({pending.length})</h2>
      {pending.length === 0 ? (
        <div className="card mb-8"><Empty>Nothing to review.</Empty></div>
      ) : (
        <ul className="mb-8 space-y-3">
          {pending.map((l) => (
            <li key={l.id} className="card p-4">
              <div className="flex items-center gap-2">
                <span className="font-medium">{l.title}</span>
                <span className="text-xs text-muted">{l.agent} · {fmtDate(l.createdAt, true)}</span>
              </div>
              <pre className="mt-2 font-sans text-sm whitespace-pre-wrap text-ink-2">{l.content}</pre>
              <div className="mt-3 flex gap-2">
                <form action={decideLearning.bind(null, l.id, true)}><button className="btn">Approve</button></form>
                <form action={decideLearning.bind(null, l.id, false)}><button className="btn-ghost">Reject</button></form>
              </div>
            </li>
          ))}
        </ul>
      )}
      <h2 className="mb-2 text-sm font-medium text-muted">History</h2>
      <div className="card">
        {done.length === 0 ? (
          <Empty>No decisions yet.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {done.map((l) => (
              <li key={l.id} className="flex items-center gap-2 px-4 py-3 text-sm">
                <span className="truncate">{l.title}</span>
                <span className="text-xs text-muted">{l.agent}</span>
                <span className="ml-auto"><Chip status={l.status} /></span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
