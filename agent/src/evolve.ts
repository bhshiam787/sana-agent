// How agents change themselves: every change snapshots the editable files first,
// is recorded in the `learnings` table, and can be reverted from the dashboard.
// Only the "## Learned rules" section of a playbook is ever edited; everything
// above it (honesty, read-only LinkedIn, no personal data, caps) is locked.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cfg, ROOT } from "./config.ts";
import { db, t } from "./db.ts";
import { log } from "./log.ts";
import { strategyPath } from "./skills.ts";

export const PLAYBOOKS = ["scout", "linkedin", "profiler", "researcher", "writer", "reviewer"] as const;
const MARKER = "## Learned rules";
const MAX_RULES = 25;

/** Copies playbooks, scoring.json and strategy.json into skills/history/<stamp>/. Returns repo-relative path. */
export function snapshot(label: string) {
  const dir = path.join(cfg.skillsDir, "history", `${new Date().toISOString().replace(/[:.]/g, "-")}-${label}`);
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(cfg.skillsDir)) if (/\.(md|json)$/.test(f)) cpSync(path.join(cfg.skillsDir, f), path.join(dir, f));
  cpSync(strategyPath(), path.join(dir, "strategy.json"));
  return path.relative(ROOT, dir);
}

/** Restores a snapshot made by `snapshot()` (also used by the dashboard's Revert). */
export function restore(snapshotRel: string) {
  const dir = path.join(ROOT, snapshotRel);
  for (const f of readdirSync(dir)) {
    const dest = f === "strategy.json" ? strategyPath() : path.join(cfg.skillsDir, f);
    cpSync(path.join(dir, f), dest);
  }
}

const playbookFile = (agent: string) => path.join(cfg.skillsDir, `${agent}.md`);

/** Appends (or replaces, by title) one rule in a playbook's Learned rules section. */
export function upsertRule(agent: string, title: string, rule: string, by: string) {
  const file = playbookFile(agent);
  if (!existsSync(file)) return false;
  const text = readFileSync(file, "utf8");
  const i = text.indexOf(MARKER);
  if (i < 0) return false;
  const head = text.slice(0, i + MARKER.length);
  const lines = text
    .slice(i + MARKER.length)
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith(`- **${title}**`));
  const kept = lines.filter((l) => l.startsWith("- **")).slice(-(MAX_RULES - 1));
  const comment = lines.filter((l) => l.startsWith("<!--"));
  writeFileSync(file, `${head}\n${[...comment, ...kept, `- **${title}** — ${rule.replace(/\n+/g, " ")} _(${by})_`].join("\n")}\n`);
  return true;
}

export function retireRule(agent: string, title: string) {
  const file = playbookFile(agent);
  if (!existsSync(file)) return false;
  const text = readFileSync(file, "utf8");
  const next = text
    .split("\n")
    .filter((l) => !l.startsWith(`- **${title}**`))
    .join("\n");
  if (next === text) return false;
  writeFileSync(file, next);
  return true;
}

export function learnedRules(agent: string) {
  const text = existsSync(playbookFile(agent)) ? readFileSync(playbookFile(agent), "utf8") : "";
  const i = text.indexOf(MARKER);
  return i < 0 ? "" : text.slice(i + MARKER.length).trim();
}

/** Records an applied self-change so the users can see and revert it. */
export async function recordChange(o: { runId: number | null; agent: string; title: string; content: string; snapshot: string }) {
  await db.insert(t.learnings).values({ ...o, status: "applied", decidedAt: new Date() });
  await log("learner", `${o.agent}: ${o.title}`);
}
