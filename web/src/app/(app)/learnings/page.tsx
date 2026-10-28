import { desc } from "drizzle-orm";
import { readFileSync } from "node:fs";
import path from "node:path";
import { db, t } from "@/db";
import { decideLearning, revertLearning } from "@/lib/actions";
import { Chip, Empty, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { SubmitButton } from "@/components/submit-button";

function currentStrategy() {
  try {
    return JSON.parse(readFileSync(path.resolve(process.cwd(), "../agent/strategy.json"), "utf8")) as {
      lastAssessment: string | null;
      updatedAt: string | null;
      addQueries: string[];
      dropQueries: string[];
      countryPriority: string[];
      countryBoost: Record<string, number>;
      topicBoost: Record<string, number>;
    };
  } catch {
    return null;
  }
}

export default async function Learnings() {
  const rows = await db.select().from(t.learnings).orderBy(desc(t.learnings.createdAt)).limit(200);
  const pending = rows.filter((r) => r.status === "proposed");
  const s = currentStrategy();

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Learnings & strategy"
        sub="The strategist and learner change the agents' focus and playbooks on their own. Every change is listed here and can be reverted."
      />

      {s && (
        <section className="card mb-6 p-4">
          <h2 className="font-medium">Current focus</h2>
          <p className="mt-1 text-xs text-muted">Strategist, updated {fmtDate(s.updatedAt, true)}</p>
          {s.lastAssessment && <p className="mt-3 text-sm text-ink-2">{s.lastAssessment}</p>}
          <dl className="mt-3 grid gap-2 text-sm md:grid-cols-2">
            <div><dt className="text-xs text-muted">Country order</dt><dd>{s.countryPriority.join(", ") || "from targets.json"}</dd></div>
            <div><dt className="text-xs text-muted">Topics added / dropped</dt><dd>{[...s.addQueries.map((q) => `+ ${q}`), ...s.dropQueries.map((q) => `− ${q}`)].join(" · ") || "none"}</dd></div>
            <div><dt className="text-xs text-muted">Country boosts</dt><dd>{Object.entries(s.countryBoost).map(([k, v]) => `${k} ${v > 0 ? "+" : ""}${v}`).join(" · ") || "none"}</dd></div>
            <div><dt className="text-xs text-muted">Topic boosts</dt><dd>{Object.entries(s.topicBoost).map(([k, v]) => `${k} +${v}`).join(" · ") || "none"}</dd></div>
          </dl>
        </section>
      )}

      {pending.length > 0 && (
        <>
          <h2 className="mb-2 text-sm font-medium text-muted">Waiting for you ({pending.length})</h2>
          <ul className="mb-8 space-y-3">
            {pending.map((l) => (
              <li key={l.id} className="card p-4">
                <div className="font-medium">{l.title}</div>
                <pre className="mt-2 font-sans text-sm whitespace-pre-wrap text-ink-2">{l.content}</pre>
                <div className="mt-3 flex gap-2">
                  <form action={decideLearning.bind(null, l.id, true)}><SubmitButton className="btn" pendingText="Applying…">Approve</SubmitButton></form>
                  <form action={decideLearning.bind(null, l.id, false)}><SubmitButton className="btn-ghost">Reject</SubmitButton></form>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 className="mb-2 text-sm font-medium text-muted">Changes the agents made</h2>
      {rows.filter((r) => r.status !== "proposed").length === 0 ? (
        <div className="card"><Empty>No changes yet. They appear after the first runs.</Empty></div>
      ) : (
        <ul className="space-y-3">
          {rows
            .filter((r) => r.status !== "proposed")
            .map((l) => (
              <li key={l.id} className={`card p-4 ${l.status === "reverted" ? "opacity-60" : ""}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{l.title}</span>
                  <span className="text-xs text-muted">{l.agent} · {fmtDate(l.createdAt, true)}</span>
                  <span className="ml-auto"><Chip status={l.status} /></span>
                </div>
                <pre className="mt-2 font-sans text-sm whitespace-pre-wrap text-ink-2">{l.content}</pre>
                {l.status === "applied" && l.snapshot && (
                  <form action={revertLearning.bind(null, l.id)} className="mt-3">
                    <SubmitButton className="btn-ghost text-xs" pendingText="Reverting…">Revert to before this change (also undoes later changes)</SubmitButton>
                  </form>
                )}
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
