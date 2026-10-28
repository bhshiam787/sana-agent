import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { db, t } from "@/db";
import { controlRun, forceStopRun } from "@/lib/actions";
import { Chip } from "@/components/ui";
import { minutesSince, timeAgo } from "@/lib/format";
import { StartRunForm } from "./start-run-form";
import { SubmitButton } from "@/components/submit-button";

/** Start / pause / resume / stop the agent from the dashboard. */
export async function AgentControl() {
  const [current] = await db
    .select({ run: t.agentRuns, by: t.users.name })
    .from(t.agentRuns)
    .leftJoin(t.users, eq(t.users.id, t.agentRuns.startedBy))
    .where(inArray(t.agentRuns.status, ["running", "paused"]))
    .orderBy(desc(t.agentRuns.id))
    .limit(1);

  if (!current) {
    return (
      <section className="card mb-6 p-4">
        <h2 className="font-medium">Agent</h2>
        <p className="mt-1 text-sm text-muted">Not running. Start it on this Mac:</p>
        <StartRunForm />
      </section>
    );
  }

  const { run, by } = current;
  const [last] = await db.select({ at: t.activity.at }).from(t.activity).where(eq(t.activity.runId, run.id)).orderBy(desc(t.activity.id)).limit(1);
  const quietMin = last ? minutesSince(last.at) : 0;
  const pending = run.control;

  return (
    <section className="card mb-6 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-medium">Agent</h2>
        <Chip status={run.status} />
        <span className="text-sm text-ink-2">
          Run #{run.id} · {run.dryRun ? "dry run (sends nothing)" : "LIVE (sends emails)"} · started {timeAgo(run.startedAt)} by {by ?? "?"}
          {run.machine ? ` on ${run.machine}` : ""} · last activity {last ? timeAgo(last.at) : "none yet"}
        </span>
        <Link href={`/runs/${run.id}`} className="ml-auto text-sm text-accent hover:underline">Live log →</Link>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {run.status === "running" ? (
          <form action={controlRun.bind(null, run.id, "pause")}>
            <SubmitButton className="btn-ghost" disabled={!!pending} pendingText="Pausing…">⏸ Pause</SubmitButton>
          </form>
        ) : (
          <form action={controlRun.bind(null, run.id, "resume")}>
            <SubmitButton className="btn" disabled={!!pending} pendingText="Resuming…">▶ Resume</SubmitButton>
          </form>
        )}
        <form action={controlRun.bind(null, run.id, "stop")}>
          <SubmitButton className="btn-ghost hover:text-critical" disabled={pending === "stop"} pendingText="Stopping…">■ Stop</SubmitButton>
        </form>
        {pending && <span className="text-xs text-muted">“{pending}” sent; the agent picks it up within ~10 seconds (running sessions finish first).</span>}
        {quietMin > 15 && (
          <form action={forceStopRun.bind(null, run.id)} className="ml-auto">
            <SubmitButton className="inline-flex items-center gap-1 text-xs text-muted hover:text-critical">No activity for {Math.round(quietMin)} min: mark as stopped</SubmitButton>
          </form>
        )}
      </div>
    </section>
  );
}
