import { db, t } from "./db.ts";

export type Agent = "run" | "scout" | "linkedin" | "profiler" | "scorer" | "writer" | "reviewer" | "sender" | "inbox" | "learner";

let runId: number | null = null;
export const setRunId = (id: number) => (runId = id);

// Counters shown on the dashboard's "last run" card.
export const stats: Record<string, number> = {};
export const bump = (key: string, by = 1) => (stats[key] = (stats[key] ?? 0) + by);

export async function log(agent: Agent, message: string, opts: { level?: "info" | "warn" | "error"; professorId?: number } = {}) {
  const level = opts.level ?? "info";
  const line = `[${new Date().toLocaleTimeString("en-GB")}] ${agent.padEnd(9)} ${level === "info" ? "" : level.toUpperCase() + ": "}${message}`;
  (level === "error" ? console.error : console.log)(line);
  try {
    await db.insert(t.activity).values({ runId, agent, level, message: message.slice(0, 2000), professorId: opts.professorId ?? null });
  } catch (e) {
    console.error("could not write activity log:", (e as Error).message);
  }
}
