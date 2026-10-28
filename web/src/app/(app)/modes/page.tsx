import Link from "next/link";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PageHeader } from "@/components/ui";

type Preset = {
  label: string;
  summary: string;
  parallel: number;
  bulkModel: string;
  profileModel: string;
  qualityModel: string;
  positionSessions: number;
  labCountries: number;
  sweepsPerRun: number;
  profilePerRun: number;
  researchPerRun: number;
};
const MODES = ["economy", "medium", "max"] as const;

// Same file the agent reads, so this page always matches what actually runs.
function presets(): Record<(typeof MODES)[number], Preset> {
  return JSON.parse(readFileSync(path.resolve(process.cwd(), "../agent/modes.json"), "utf8"));
}

const model = (m: string) => (m.includes("sonnet") ? "Sonnet" : m.includes("opus") ? "Opus" : m.includes("haiku") ? "Haiku" : m);
const cap = (n: number) => (n >= 99 ? "no limit" : String(n));

export default function Modes() {
  const p = presets();
  const rows: { label: string; help: string; value: (x: Preset) => string }[] = [
    { label: "Claude sessions at once", help: "How much runs in parallel (faster, but uses the plan faster)", value: (x) => String(x.parallel) },
    { label: "Finders, faculty sweeps, inbox", help: "High-volume searching and reading", value: (x) => model(x.bulkModel) },
    { label: "Professor research & scoring", help: "Decides fit/funding and who is shortlisted", value: (x) => model(x.profileModel) },
    { label: "Dossiers, email writing, reviewer, strategist", help: "Where quality matters most", value: (x) => model(x.qualityModel) },
    { label: "Job-board searches", help: "Sessions searching EURAXESS, FindAPhD, university portals…", value: (x) => (x.positionSessions >= 99 ? "1 per topic" : `${x.positionSessions} (topics grouped)`) },
    { label: "Recruiting-lab countries", help: "Countries searched for “we are recruiting” pages", value: (x) => (x.labCountries >= 99 ? "all preferred" : `top ${x.labCountries}`) },
    { label: "University staff-list sweeps per run", help: "Universities whose faculty pages are read", value: (x) => cap(x.sweepsPerRun) },
    { label: "Professors researched per run", help: "Profiler limit", value: (x) => cap(x.profilePerRun) },
    { label: "Deep dossiers per run", help: "Full background research before writing", value: (x) => cap(x.researchPerRun) },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Run modes" sub="What each mode does. Choose one in the Start form on the Overview page." />

      <div className="mb-6 grid gap-3 md:grid-cols-3">
        {MODES.map((m) => (
          <div key={m} className="card p-4">
            <div className="font-medium">{p[m].label}{m === "economy" && <span className="ml-2 text-xs text-muted">default</span>}</div>
            <p className="mt-1 text-sm text-ink-2">{p[m].summary}</p>
          </div>
        ))}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead className="border-b border-line">
            <tr>
              <th className="th">Setting</th>
              {MODES.map((m) => (
                <th key={m} className="th text-center">{p[m].label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.label} className="row-hover">
                <td className="td">
                  <div className="font-medium">{r.label}</div>
                  <div className="text-xs text-muted">{r.help}</div>
                </td>
                {MODES.map((m) => {
                  const v = r.value(p[m]);
                  return (
                    <td key={m} className={`td text-center tabular-nums ${v === "Opus" ? "text-accent" : ""}`}>{v}</td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="card mt-6 p-4 text-sm text-ink-2">
        <h2 className="mb-2 font-medium text-ink">Same in every mode</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>At most 20 emails per night, spaced out, one email + one follow-up per professor.</li>
          <li>Pauses at 85% of the Claude 5-hour usage window and resumes after it resets.</li>
          <li>Reviewer quality gate, honesty rules, posted contact instructions respected.</li>
        </ul>
        <p className="mt-3">
          Start a run from the <Link href="/" className="text-accent">Overview</Link>. In the terminal: <code>pnpm dry</code> / <code>pnpm dry:medium</code> / <code>pnpm dry:max</code> (and <code>night</code> for live).
        </p>
      </section>
    </div>
  );
}
