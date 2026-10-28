import Link from "next/link";
import { and, desc, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import { db, t } from "@/db";
import { Chip, Empty, PageHeader } from "@/components/ui";
import { score } from "@/lib/format";

const CONTACTED = ["shortlisted", "emailed", "followed_up", "replied", "positive", "interview", "offer", "rejected"] as const;

// Same person found twice; kept out of the real rejection list.
const DUP = sql`coalesce(${t.professors.notes}, '') like 'Duplicate%'`;

const TABS = {
  shortlisted: {
    label: "Shortlisted",
    help: "Researched and good enough to email (priority ≥ 60 with an official email).",
    where: inArray(t.professors.status, [...CONTACTED]),
  },
  kept: {
    label: "Kept, not shortlisted",
    help: "Researched and still possible, but not emailed: no official email or priority below 60.",
    where: eq(t.professors.status, "researched"),
  },
  rejected: {
    label: "Rejected after research",
    help: "Researched, then ruled out.",
    where: and(eq(t.professors.status, "skipped"), isNotNull(t.professors.fitScore), sql`not (${DUP})`),
  },
  skipped: {
    label: "Skipped before research",
    help: "Set aside without researching (out of scope, duplicate, co-author…).",
    where: and(eq(t.professors.status, "skipped"), isNull(t.professors.fitScore), sql`not (${DUP})`),
  },
  duplicates: {
    label: "Duplicates",
    help: "The same person found twice by different finders; only one record is ever contacted.",
    where: and(eq(t.professors.status, "skipped"), DUP),
  },
} satisfies Record<string, { label: string; help: string; where: SQL | undefined }>;
type Tab = keyof typeof TABS;

/** Plain-language reason for where a professor ended up. */
function reason(tab: Tab, p: typeof t.professors.$inferSelect) {
  if (tab === "shortlisted") return p.whyMatch ?? p.summary ?? "";
  if (tab === "kept") {
    if (!p.email) return "No official email found";
    return `Priority ${score(p.priorityScore)}, below 60 (fit ${score(p.fitScore)}, funding ${score(p.fundingScore)})`;
  }
  return (p.notes ?? "No reason recorded").replace(/^WARM CONTACT — do not auto-email\. /, "Co-author / warm contact: Tamanna should email personally. ");
}

export default async function Research(props: PageProps<"/research">) {
  const sp = await props.searchParams;
  const tab: Tab = typeof sp.tab === "string" && sp.tab in TABS ? (sp.tab as Tab) : "shortlisted";

  const [counts, rows] = await Promise.all([
    Promise.all(
      (Object.keys(TABS) as Tab[]).map(async (k) => {
        const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(t.professors).where(TABS[k].where);
        return [k, n] as const;
      }),
    ),
    db
      .select({ p: t.professors, uni: t.universities.name })
      .from(t.professors)
      .leftJoin(t.universities, eq(t.universities.id, t.professors.universityId))
      .where(TABS[tab].where)
      .orderBy(sql`${t.professors.priorityScore} desc nulls last`, desc(t.professors.updatedAt))
      .limit(500),
  ]);
  const n = Object.fromEntries(counts) as Record<Tab, number>;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Research results" sub="Every professor the agent looked at: who was kept, who was rejected, and why." />

      <div className="mb-4 flex flex-wrap gap-2">
        {(Object.keys(TABS) as Tab[]).map((k) => (
          <Link key={k} href={`/research?tab=${k}`} className={`btn-ghost ${k === tab ? "border-hover-line bg-hover text-ink" : ""}`}>
            {TABS[k].label}
            <span className="rounded-full bg-surface-2 px-2 text-xs tabular-nums">{n[k]}</span>
          </Link>
        ))}
      </div>
      <p className="mb-3 text-sm text-muted">{TABS[tab].help}</p>

      <div className="card overflow-x-auto">
        {rows.length === 0 ? (
          <Empty>Nobody here yet.</Empty>
        ) : (
          <table className="w-full min-w-[900px]">
            <thead className="border-b border-line">
              <tr>
                <th className="th">Professor</th>
                <th className="th">University</th>
                <th className="th text-right">Fit</th>
                <th className="th text-right">Funding</th>
                <th className="th text-right">Priority</th>
                <th className="th">{tab === "shortlisted" ? "Why she fits" : "Reason"}</th>
                {tab === "shortlisted" && <th className="th">Status</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map(({ p, uni }) => (
                <tr key={p.id} className="row-hover">
                  <td className="td">
                    <Link href={`/professors/${p.id}`} className="font-medium hover:underline">{p.fullName}</Link>
                    <div className="text-xs text-muted">{p.title ?? ""}</div>
                  </td>
                  <td className="td">
                    <div>{uni ?? "—"}</div>
                    <div className="text-xs text-muted">{p.country}</div>
                  </td>
                  <td className="td text-right tabular-nums">{score(p.fitScore)}</td>
                  <td className="td text-right tabular-nums">{score(p.fundingScore)}</td>
                  <td className="td text-right font-medium tabular-nums">{score(p.priorityScore)}</td>
                  <td className="td max-w-xl text-sm text-ink-2">
                    <span className="line-clamp-3">{reason(tab, p)}</span>
                  </td>
                  {tab === "shortlisted" && (
                    <td className="td"><Chip status={p.status} /></td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
