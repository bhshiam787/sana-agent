import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, t } from "@/db";
import { AgentControl } from "@/components/agent-control";
import { Chip, Empty, PageHeader } from "@/components/ui";
import { fmtDate, label } from "@/lib/format";

function duration(a: Date, b: Date | null) {
  if (!b) return "running";
  const m = Math.round((+b - +a) / 60000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

export default async function Runs() {
  const rows = await db
    .select({ run: t.agentRuns, by: t.users.name })
    .from(t.agentRuns)
    .leftJoin(t.users, eq(t.users.id, t.agentRuns.startedBy))
    .orderBy(desc(t.agentRuns.startedAt))
    .limit(100);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Agent runs" sub="Each overnight run: who started it, how long it took, what it did.">
        <Link href="/modes" className="btn-ghost">Run modes</Link>
      </PageHeader>
      <AgentControl />
      <div className="card overflow-x-auto">
        {rows.length === 0 ? (
          <Empty>The agent hasn&apos;t run yet.</Empty>
        ) : (
          <table className="w-full min-w-[800px]">
            <thead className="border-b border-line">
              <tr>
                <th className="th">Started</th>
                <th className="th">By</th>
                <th className="th">Duration</th>
                <th className="th">Type</th>
                <th className="th">Mode</th>
                <th className="th">Results</th>
                <th className="th">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map(({ run, by }) => (
                <tr key={run.id} className="row-hover">
                  <td className="td whitespace-nowrap">
                    <Link href={`/runs/${run.id}`} className="hover:underline">{fmtDate(run.startedAt, true)}</Link>
                  </td>
                  <td className="td">
                    {by ?? "—"}
                    {run.machine && <div className="text-xs text-muted">{run.machine}</div>}
                  </td>
                  <td className="td">{duration(run.startedAt, run.endedAt)}</td>
                  <td className="td text-sm">{run.dryRun ? "Dry run" : "Live"}</td>
                  <td className="td text-sm">{run.mode ? run.mode[0].toUpperCase() + run.mode.slice(1) : "—"}</td>
                  <td className="td text-xs text-ink-2">
                    {run.stats ? Object.entries(run.stats).map(([k, v]) => `${label(k)}: ${v}`).join(" · ") : "—"}
                  </td>
                  <td className="td"><Chip status={run.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
