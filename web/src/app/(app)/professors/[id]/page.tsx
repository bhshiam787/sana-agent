import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import { db, t } from "@/db";
import { updateProfessor } from "@/lib/actions";
import { Chip, Empty, ExtLink } from "@/components/ui";
import { daysFromNow, fmtDate, isoDay, label, score } from "@/lib/format";

export default async function ProfessorPage(props: PageProps<"/professors/[id]">) {
  const id = Number((await props.params).id);
  if (!Number.isInteger(id)) notFound();

  const [[row], papers, grants, emails, replies, positions, log] = await Promise.all([
    db
      .select({ p: t.professors, uni: t.universities })
      .from(t.professors)
      .leftJoin(t.universities, eq(t.universities.id, t.professors.universityId))
      .where(eq(t.professors.id, id)),
    db.select().from(t.papers).where(eq(t.papers.professorId, id)).orderBy(desc(t.papers.year)),
    db.select().from(t.grants).where(eq(t.grants.professorId, id)).orderBy(desc(t.grants.endDate)),
    db.select().from(t.emails).where(eq(t.emails.professorId, id)).orderBy(asc(t.emails.createdAt)),
    db.select().from(t.replies).where(eq(t.replies.professorId, id)).orderBy(asc(t.replies.receivedAt)),
    db.select().from(t.positions).where(eq(t.positions.professorId, id)),
    db.select().from(t.activity).where(eq(t.activity.professorId, id)).orderBy(desc(t.activity.at)).limit(30),
  ]);
  if (!row) notFound();
  const { p, uni } = row;
  const today = isoDay(daysFromNow(0));

  // Emails and replies in one timeline.
  const thread = [
    ...emails.map((e) => ({ at: e.sentAt ?? e.createdAt, kind: "email" as const, e })),
    ...replies.map((r) => ({ at: r.receivedAt, kind: "reply" as const, r })),
  ].sort((a, b) => +new Date(a.at) - +new Date(b.at));

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/professors" className="text-sm text-muted hover:text-ink">
        ← Professors
      </Link>
      <div className="mt-2 mb-6 flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold">{p.fullName}</h1>
          <p className="text-sm text-ink-2">
            {[p.title, p.department, uni?.name, p.country].filter(Boolean).join(" · ")}
          </p>
          <div className="mt-2 flex flex-wrap gap-3 text-sm">
            {p.email && <a href={`mailto:${p.email}`} className="text-accent hover:underline">{p.email}</a>}
            <ExtLink href={p.homepage}>Homepage</ExtLink>
            <ExtLink href={p.labUrl}>Lab</ExtLink>
            <ExtLink href={p.scholarUrl}>Scholar</ExtLink>
            <ExtLink href={p.linkedinUrl}>LinkedIn</ExtLink>
            <ExtLink href={p.sourceUrl}>Found via {p.source ?? "source"}</ExtLink>
          </div>
        </div>
        <Chip status={p.status} />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          ["Priority", score(p.priorityScore)],
          ["Fit", score(p.fitScore)],
          ["Funding", score(p.fundingScore)],
          ["Reply likelihood", score(p.replyScore)],
          ["h-index", p.hIndex ?? "—"],
        ].map(([k, v]) => (
          <div key={k} className="card p-3">
            <div className="text-xs text-muted">{k}</div>
            <div className="text-xl font-semibold tabular-nums">{v}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="card p-4">
            <h2 className="mb-2 font-medium">What they work on</h2>
            <p className="text-sm whitespace-pre-line text-ink-2">{p.summary ?? "Not researched yet."}</p>
            {p.researchAreas?.length ? (
              <div className="mt-3 flex flex-wrap gap-1">
                {p.researchAreas.map((a) => (
                  <span key={a} className="rounded-full bg-surface-2 px-2 py-0.5 text-xs">{a}</span>
                ))}
              </div>
            ) : null}
            {p.whyMatch && (
              <>
                <h3 className="mt-4 mb-1 text-sm font-medium">Why Tamanna fits</h3>
                <p className="text-sm whitespace-pre-line text-ink-2">{p.whyMatch}</p>
              </>
            )}
            {p.recruitingEvidence && (
              <>
                <h3 className="mt-4 mb-1 text-sm font-medium">Recruiting evidence</h3>
                <p className="text-sm whitespace-pre-line text-ink-2">{p.recruitingEvidence}</p>
              </>
            )}
          </section>

          {p.dossier && (
            <section className="card p-4">
              <h2 className="mb-3 font-medium">Deep research</h2>
              {p.contactInstructions && (
                <p className="mb-3 rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm">
                  <span className="font-medium">Their instructions for applicants:</span> {p.contactInstructions}
                </p>
              )}
              <dl className="space-y-3 text-sm">
                {[
                  ["Where they're heading", p.dossier.currentDirection],
                  ["Research trajectory", p.dossier.researchTrajectory],
                  ["What they value in students", p.dossier.valuesInStudents],
                  ["How they write", p.dossier.communicationStyle],
                  ["Lab culture", p.dossier.labCulture],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs text-muted">{k}</dt>
                    <dd className="whitespace-pre-line text-ink-2">{v}</dd>
                  </div>
                ))}
              </dl>
              {p.dossier.hooks.length > 0 && (
                <>
                  <h3 className="mt-4 mb-1 text-sm font-medium">Talking points used in emails</h3>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
                    {p.dossier.hooks.map((h) => (
                      <li key={h.point}>{h.point} <ExtLink href={h.source}>source</ExtLink></li>
                    ))}
                  </ul>
                </>
              )}
              {p.dossier.careerTimeline.length > 0 && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm font-medium">Career timeline</summary>
                  <ul className="mt-2 space-y-1 text-sm text-ink-2">
                    {p.dossier.careerTimeline.map((c) => (
                      <li key={c.year + c.event}><span className="text-muted tabular-nums">{c.year}</span> · {c.event}</li>
                    ))}
                  </ul>
                </details>
              )}
              {p.dossier.redFlags.length > 0 && (
                <p className="mt-4 text-sm"><span className="font-medium">⚠ Watch out:</span> <span className="text-ink-2">{p.dossier.redFlags.join(" · ")}</span></p>
              )}
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-muted">{p.dossier.sources.length} sources · researched {fmtDate(p.dossier.researchedAt)}</summary>
                <ul className="mt-2 space-y-0.5 text-xs">
                  {p.dossier.sources.map((s) => <li key={s} className="truncate"><ExtLink href={s}>{s}</ExtLink></li>)}
                </ul>
              </details>
            </section>
          )}

          <section className="card">
            <h2 className="border-b border-line px-4 py-3 font-medium">Emails & replies</h2>
            {thread.length === 0 ? (
              <Empty>Not contacted yet.</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {thread.map((m) =>
                  m.kind === "email" ? (
                    <li key={`e${m.e.id}`} className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium">Sent: {m.e.subject}</span>
                        <Chip status={m.e.status} />
                        <span className="text-xs text-muted">{label(m.e.kind)}</span>
                        <span className="ml-auto text-xs text-muted">{fmtDate(m.at, true)}</span>
                      </div>
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-muted">Show email</summary>
                        <pre className="mt-2 font-sans text-sm whitespace-pre-wrap text-ink-2">{m.e.body}</pre>
                        {m.e.reviewNotes && <p className="mt-2 text-xs text-muted">Reviewer ({score(m.e.reviewScore)}): {m.e.reviewNotes}</p>}
                      </details>
                    </li>
                  ) : (
                    <li key={`r${m.r.id}`} className="bg-surface-2/50 px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium">Reply</span>
                        <Chip status={m.r.classification} />
                        <span className="ml-auto text-xs text-muted">{fmtDate(m.at, true)}</span>
                      </div>
                      <pre className="mt-2 font-sans text-sm whitespace-pre-wrap text-ink-2">{m.r.body ?? m.r.snippet}</pre>
                      {m.r.suggestedAction && <p className="mt-2 text-sm"><span className="font-medium">Next step:</span> {m.r.suggestedAction}</p>}
                    </li>
                  ),
                )}
              </ul>
            )}
          </section>

          <section className="card">
            <h2 className="border-b border-line px-4 py-3 font-medium">Recent papers</h2>
            {papers.length === 0 ? (
              <Empty>No papers collected.</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {papers.map((pp) => (
                  <li key={pp.id} className="px-4 py-3 text-sm">
                    <div className="flex gap-2">
                      {pp.url ? <ExtLink href={pp.url}>{pp.title}</ExtLink> : <span>{pp.title}</span>}
                      <span className="ml-auto shrink-0 text-xs text-muted">{pp.year}</span>
                    </div>
                    {pp.venue && <div className="text-xs text-muted">{pp.venue}</div>}
                    {pp.summary && <p className="mt-1 text-xs text-ink-2">{pp.summary}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="space-y-6">
          <form action={updateProfessor.bind(null, p.id)} className="card space-y-3 p-4">
            <h2 className="font-medium">Your notes</h2>
            <select name="status" defaultValue={p.status} className="input w-full">
              {t.professorStatus.enumValues.map((s) => (
                <option key={s} value={s}>{label(s)}</option>
              ))}
            </select>
            <textarea name="notes" defaultValue={p.notes ?? ""} rows={5} className="input w-full" placeholder="Anything to remember…" />
            <button className="btn w-full">Save</button>
            <p className="text-xs text-muted">
              Last contacted {fmtDate(p.lastContactedAt)} · follow-up {fmtDate(p.nextFollowUpAt)}
            </p>
          </form>

          <section className="card">
            <h2 className="border-b border-line px-4 py-3 font-medium">Funding / grants</h2>
            {grants.length === 0 ? (
              <Empty>No grants found.</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {grants.map((g) => (
                  <li key={g.id} className="px-4 py-3 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{g.funder}</span>
                      {g.endDate && g.endDate >= today && <span className="text-xs text-good">● active</span>}
                    </div>
                    {g.url ? <ExtLink href={g.url}>{g.title ?? "Grant"}</ExtLink> : <div>{g.title}</div>}
                    <div className="text-xs text-muted">
                      {g.amount ? `${g.currency ?? ""} ${g.amount.toLocaleString()} · ` : ""}
                      {g.startDate ?? "?"} → {g.endDate ?? "?"}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {positions.length > 0 && (
            <section className="card">
              <h2 className="border-b border-line px-4 py-3 font-medium">Open positions</h2>
              <ul className="divide-y divide-line">
                {positions.map((pos) => (
                  <li key={pos.id} className="px-4 py-3 text-sm">
                    <ExtLink href={pos.url}>{pos.title}</ExtLink>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                      Deadline {fmtDate(pos.deadline)} <span className="ml-auto"><Chip status={pos.status} /></span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card">
            <h2 className="border-b border-line px-4 py-3 font-medium">Agent activity</h2>
            {log.length === 0 ? (
              <Empty>Nothing logged.</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {log.map((a) => (
                  <li key={a.id} className="px-4 py-2 text-xs">
                    <span className="text-muted">{fmtDate(a.at, true)} · {a.agent}</span>
                    <div className="text-ink-2">{a.message}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
