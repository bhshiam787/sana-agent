import Link from "next/link";
import { and, desc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { db, t } from "@/db";
import { ActivityChart, type Point } from "@/components/activity-chart";
import { AgentControl } from "@/components/agent-control";
import { Chip, Empty, PageHeader, Stat, withParams } from "@/components/ui";
import { daysFromNow, fmtDate, isoDay, label, timeAgo } from "@/lib/format";

const RANGES = { "7": "7 days", "30": "30 days", "90": "90 days", "365": "1 year" } as const;
const GRAINS = ["day", "week", "month"] as const;

const count = sql<number>`count(*)::int`;

export default async function Overview(props: PageProps<"/">) {
  const sp = await props.searchParams;
  const range = (typeof sp.range === "string" && sp.range in RANGES ? sp.range : "30") as keyof typeof RANGES;
  const grain = GRAINS.find((g) => g === sp.grain) ?? "day";
  const since = daysFromNow(-Number(range));

  const [[profs], [emailsAgg], [replyAgg], [posAgg], lastRun, funnel, series, followUps, recentReplies, deadlines] =
    await Promise.all([
      db
        .select({
          total: count,
          // Researched = the profiler finished them (scored), whether kept or rejected afterwards.
          researched: sql<number>`count(*) filter (where ${t.professors.status} <> 'discovered' and (${t.professors.fitScore} is not null or ${t.professors.status} <> 'skipped'))::int`,
          rejected: sql<number>`count(*) filter (where ${t.professors.status} = 'skipped' and ${t.professors.fitScore} is not null)::int`,
          skipped: sql<number>`count(*) filter (where ${t.professors.status} = 'skipped')::int`,
          shortlisted: sql<number>`count(*) filter (where ${t.professors.status} = 'shortlisted')::int`,
        })
        .from(t.professors),
      db
        .select({
          sent: count,
          inRange: sql<number>`count(*) filter (where ${t.emails.sentAt} >= ${since})::int`,
          followUps: sql<number>`count(*) filter (where ${t.emails.kind} = 'follow_up')::int`,
        })
        .from(t.emails)
        .where(eq(t.emails.status, "sent")),
      db
        .select({
          total: sql<number>`count(distinct ${t.replies.professorId})::int`,
          positive: sql<number>`count(distinct ${t.replies.professorId}) filter (where ${t.replies.classification} in ('positive','ask_cv','apply_formally'))::int`,
          unhandled: sql<number>`count(*) filter (where not ${t.replies.handled} and ${t.replies.classification} <> 'auto_reply')::int`,
        })
        .from(t.replies),
      db
        .select({
          applied: sql<number>`count(*) filter (where ${t.positions.status} = 'applied')::int`,
          manual: sql<number>`count(*) filter (where ${t.positions.status} = 'needs_manual')::int`,
        })
        .from(t.positions),
      db
        .select({ run: t.agentRuns, by: t.users.name })
        .from(t.agentRuns)
        .leftJoin(t.users, eq(t.users.id, t.agentRuns.startedBy))
        .orderBy(desc(t.agentRuns.startedAt))
        .limit(1),
      db.select({ status: t.professors.status, n: count }).from(t.professors).groupBy(t.professors.status),
      db.execute<Point>(sql`
        with buckets as (
          select generate_series(date_trunc(${grain}, ${since}::timestamptz), date_trunc(${grain}, now()), ('1 ' || ${grain})::interval) as b
        )
        select to_char(b, ${grain === "month" ? "Mon YYYY" : "DD Mon"}) as bucket,
          (select count(*) from emails e where e.status = 'sent' and date_trunc(${grain}, e.sent_at) = b)::int as sent,
          (select count(*) from replies r where date_trunc(${grain}, r.received_at) = b)::int as replies
        from buckets order by b`),
      db
        .select({ id: t.professors.id, name: t.professors.fullName, due: t.professors.nextFollowUpAt })
        .from(t.professors)
        .where(and(isNotNull(t.professors.nextFollowUpAt), lte(t.professors.nextFollowUpAt, daysFromNow(3)), eq(t.professors.status, "emailed")))
        .orderBy(t.professors.nextFollowUpAt)
        .limit(6),
      db
        .select({ r: t.replies, name: t.professors.fullName })
        .from(t.replies)
        .innerJoin(t.professors, eq(t.professors.id, t.replies.professorId))
        .orderBy(desc(t.replies.receivedAt))
        .limit(6),
      db
        .select()
        .from(t.positions)
        .where(and(gte(t.positions.deadline, isoDay(daysFromNow(0))), sql`${t.positions.status} not in ('closed','rejected')`))
        .orderBy(t.positions.deadline)
        .limit(6),
    ]);

  const byStatus = Object.fromEntries(funnel.map((f) => [f.status, f.n]));
  // followed_up is a side state, not a stage every reply passes through.
  const later = ["shortlisted", "emailed", "replied", "positive", "interview", "offer"];
  // Cumulative: a professor at "replied" has also passed every earlier stage.
  // Found and Researched use the same numbers as the boxes above (skipped ones included).
  const reached = [
    { stage: "found", n: profs.total, href: "/professors" },
    { stage: "researched", n: profs.researched, href: "/research?tab=all" },
    ...later.map((s, i) => ({ stage: s, n: later.slice(i).reduce((sum, x) => sum + (byStatus[x] ?? 0), 0), href: `/professors?stage=${s}` })),
  ];
  const maxReached = Math.max(1, reached[0].n);
  const replyRate = emailsAgg.sent ? Math.round(((replyAgg.total ?? 0) / (emailsAgg.sent - emailsAgg.followUps || 1)) * 100) : 0;
  const run = lastRun[0];
  const cur = { range, grain };

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Overview" sub="Everything the agent has done, and what needs you." />
      <AgentControl />

      {run && (
        <div className="card mb-6 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium">Last run</span>
            <Chip status={run.run.status} />
            {run.run.dryRun && <Chip status="dry_run" />}
            <span className="text-sm text-ink-2">
              started {timeAgo(run.run.startedAt)} by {run.by ?? "unknown"}
              {run.run.machine ? ` on ${run.run.machine}` : ""}
            </span>
            <Link href={`/runs/${run.run.id}`} className="ml-auto text-sm text-accent hover:underline">
              Details →
            </Link>
          </div>
          {run.run.stats && (
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              {Object.entries(run.run.stats).map(([k, v]) => (
                <span key={k}>
                  <span className="text-muted">{label(k)}:</span> <span className="font-medium tabular-nums">{v}</span>
                </span>
              ))}
            </div>
          )}
          {run.run.summary && <p className="mt-3 text-sm text-ink-2">{run.run.summary}</p>}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="Professors found" value={profs.total} href="/professors" />
        <Stat label="Researched" value={profs.researched} hint="kept or rejected, with reasons" href="/research?tab=all" />
        <Stat label="Shortlisted" value={profs.shortlisted} hint="ready to email" href="/professors?status=shortlisted" />
        <Stat label="Emails sent" value={emailsAgg.sent} hint={`${emailsAgg.inRange} in last ${RANGES[range]}`} href="/emails?status=sent" />
        <Stat label="Replies" value={replyAgg.total} hint={`${replyRate}% reply rate`} href="/replies" />
        <Stat label="Positive replies" value={replyAgg.positive} href="/replies?class=positive" />
        <Stat label="Formal applications" value={posAgg.applied} hint={`${posAgg.manual} need you`} href="/positions?status=applied&open=all" />
        <Stat label="Replies to handle" value={replyAgg.unhandled} href="/replies?handled=no" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <section className="card p-4 lg:col-span-2">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="mr-auto font-medium">Activity</h2>
            {Object.entries(RANGES).map(([k, v]) => (
              <Link key={k} href={withParams("/", cur, { range: k })} className={`btn-ghost ${k === range ? "bg-surface-2 text-ink" : ""}`}>
                {v}
              </Link>
            ))}
            <span className="mx-1 h-5 w-px bg-line" />
            {GRAINS.map((g) => (
              <Link key={g} href={withParams("/", cur, { grain: g })} className={`btn-ghost ${g === grain ? "bg-surface-2 text-ink" : ""}`}>
                {label(g)}
              </Link>
            ))}
          </div>
          <ActivityChart data={series.rows} />
        </section>

        <section className="card p-4">
          <h2 className="mb-3 font-medium">Pipeline</h2>
          <div className="space-y-2">
            {reached.map((r) => (
              <Link key={r.stage} href={r.href} className="group hover-row">
                <div className="flex justify-between text-xs">
                  <span className="text-ink-2 group-hover:text-ink">{label(r.stage)}</span>
                  <span className="tabular-nums">{r.n}</span>
                </div>
                <div className="mt-1 h-2 rounded bg-surface-2">
                  <div className="h-2 rounded bg-accent" style={{ width: `${(r.n / maxReached) * 100}%` }} />
                </div>
              </Link>
            ))}
            <Link href="/professors?status=skipped" className="group hover-row mt-3 flex justify-between border-t border-line pt-3 text-xs text-muted">
              <span className="group-hover:text-ink">Skipped (not a fit, duplicate, no email, out of scope, co-author)</span>
              <span className="ml-3 shrink-0 tabular-nums">{profs.skipped}</span>
            </Link>
          </div>
        </section>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <section className="card">
          <h2 className="border-b border-line px-4 py-3 font-medium">Latest replies</h2>
          {recentReplies.length === 0 ? (
            <Empty>No replies yet.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {recentReplies.map(({ r, name }) => (
                <li key={r.id} className="row-hover px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Link href={`/professors/${r.professorId}`} className="truncate text-sm font-medium hover:underline">
                      {name}
                    </Link>
                    <span className="ml-auto">
                      <Chip status={r.classification} />
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-ink-2">{r.snippet}</p>
                  <p className="mt-1 text-xs text-muted">{timeAgo(r.receivedAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h2 className="border-b border-line px-4 py-3 font-medium">Follow-ups due (3 days)</h2>
          {followUps.length === 0 ? (
            <Empty>Nothing due.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {followUps.map((f) => (
                <li key={f.id} className="flex items-center px-4 py-3 text-sm">
                  <Link href={`/professors/${f.id}`} className="truncate hover:underline">
                    {f.name}
                  </Link>
                  <span className="ml-auto text-xs text-muted">{fmtDate(f.due)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h2 className="border-b border-line px-4 py-3 font-medium">Upcoming deadlines</h2>
          {deadlines.length === 0 ? (
            <Empty>No open deadlines.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {deadlines.map((p) => (
                <li key={p.id} className="row-hover px-4 py-3 text-sm">
                  <a href={p.url} target="_blank" rel="noreferrer" className="line-clamp-1 hover:underline">
                    {p.title}
                  </a>
                  <div className="mt-1 flex gap-2 text-xs text-muted">
                    <span>{fmtDate(p.deadline)}</span>
                    {p.country && <span>· {p.country}</span>}
                    <span className="ml-auto">
                      <Chip status={p.status} />
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
