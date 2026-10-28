import { query, type McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { mkdirSync } from "node:fs";
import { z } from "zod";
import { cfg } from "./config.ts";
import { bump, log } from "./log.ts";
import { Semaphore } from "./sem.ts";

/** Thrown when the Claude plan's usage limit (or rate limit) stops the run. Next run resumes. */
export class UsageLimitError extends Error {}
/** Stop pressed on the dashboard: ends the run like a usage stop, but on purpose. */
export class StopRequested extends UsageLimitError {}

/** Set by the run's control poller from dashboard buttons. */
export const control = { paused: false, stopRequested: false };

/** Holds new sessions while paused from the dashboard; paused time extends the run. */
export async function waitIfPaused() {
  if (control.paused && !control.stopRequested) {
    const start = Date.now();
    while (control.paused && !control.stopRequested) await new Promise((r) => setTimeout(r, 5000));
    pausedTotal += Date.now() - start;
  }
  if (control.stopRequested) throw new StopRequested("Stopped from the dashboard");
}

type AskOpts<S extends z.ZodType> = {
  prompt: string;
  system: string;
  schema: S;
  /** Built-in tools to allow, e.g. ["WebSearch", "WebFetch"]. Everything else is denied. */
  tools?: string[];
  mcpServers?: Record<string, McpServerConfig>;
  maxTurns?: number;
  effort?: "low" | "medium" | "high";
  /** Which model: "bulk" (finders, sweeps, inbox), "profile" (professor scoring), "quality" (default). */
  tier?: "bulk" | "profile" | "quality";
};

const LIMIT_RE = /usage limit|rate limit|limit reached|429|overloaded|quota/i;

/**
 * One Claude Code session that must end with JSON matching `schema`.
 * Runs on the local Claude Code login; project settings/hooks are not loaded.
 */
export function ask<S extends z.ZodType>(o: AskOpts<S>): Promise<z.infer<S>> {
  return sessions.run(() => askNow(o));
}

// Every Claude session in the process shares this cap (PARALLEL).
export const sessions = new Semaphore(cfg.parallel);

/** Latest claude.ai plan utilization (percent, 0-100) seen in any session. */
export const planUsage: { fiveHour: number | null; resetsAt: number | null; checkedAt: number } = { fiveHour: null, resetsAt: null, checkedAt: 0 };

function noteUsage(utilization: number | null | undefined, resetsAt?: number | string | null) {
  if (utilization == null) return;
  // Session events may report a 0-1 fraction; /usage reports 0-100.
  planUsage.fiveHour = utilization <= 1 ? utilization * 100 : utilization;
  if (resetsAt != null) planUsage.resetsAt = typeof resetsAt === "string" ? Date.parse(resetsAt) : resetsAt < 1e12 ? resetsAt * 1000 : resetsAt;
}

let pausing: Promise<void> | null = null;
let pausedTotal = 0;
/** Milliseconds spent paused for the usage window; run deadlines are extended by this. */
export const pausedMs = () => pausedTotal;
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/**
 * Before a new session: once the 5-hour window passes USAGE_STOP_PERCENT, wait
 * until it resets (all callers share one wait), then continue. In-flight
 * sessions finish. With RESUME_AFTER_RESET=0 the run stops instead.
 */
async function waitForBudget() {
  while (planUsage.fiveHour != null && planUsage.fiveHour >= cfg.usageStopPercent) {
    const used = Math.round(planUsage.fiveHour);
    if (!cfg.resumeAfterReset)
      throw new UsageLimitError(`5-hour Claude usage at ${used}%, stop threshold ${cfg.usageStopPercent}%${planUsage.resetsAt ? ` (resets ${hhmm(planUsage.resetsAt)})` : ""}`);
    pausing ??= (async () => {
      // Unknown reset time: re-check in 30 minutes.
      const until = Math.max(Date.now() + 60_000, (planUsage.resetsAt ?? Date.now() + 30 * 60_000) + 60_000);
      await log("run", `Claude 5-hour usage at ${used}% (limit ${cfg.usageStopPercent}%): pausing new work until ${hhmm(until)}, then resuming automatically`, { level: "warn" });
      const start = Date.now();
      await new Promise((res) => setTimeout(res, until - start));
      pausedTotal += Date.now() - start;
      planUsage.fiveHour = null; // re-measured by the next session
      planUsage.checkedAt = 0;
      await log("run", "Usage window reset: resuming");
    })().finally(() => (pausing = null));
    await pausing;
  }
}

async function askNow<S extends z.ZodType>(o: AskOpts<S>, retried = false): Promise<z.infer<S>> {
  await waitIfPaused();
  await waitForBudget();
  mkdirSync(cfg.workDir, { recursive: true });
  const allowed = [...(o.tools ?? []), ...Object.keys(o.mcpServers ?? {}).map((s) => `mcp__${s}`)];
  let result: Awaited<ReturnType<typeof firstResult>>;
  try {
    result = await firstResult(
      query({
        prompt: o.prompt,
        options: {
          model: o.tier === "bulk" ? cfg.bulkModel : o.tier === "profile" ? cfg.profileModel : cfg.qualityModel,
          systemPrompt: o.system,
          cwd: cfg.workDir,
          settingSources: [],
          allowedTools: allowed,
          permissionMode: "dontAsk",
          mcpServers: o.mcpServers,
          maxTurns: o.maxTurns ?? 20,
          effort: o.effort ?? "medium",
          outputFormat: { type: "json_schema", schema: jsonSchema(o.schema) },
        },
      }),
    );
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    if (LIMIT_RE.test(msg)) return hitLimit(o, retried, msg);
    throw e;
  }
  bump("claude_calls");
  if (result.subtype !== "success" || result.is_error) {
    const why = "errors" in result ? result.errors.join("; ") : result.result;
    if (result.api_error_status === 429 || LIMIT_RE.test(why ?? "")) return hitLimit(o, retried, why ?? "rate limited");
    throw new Error(`Claude session failed (${result.subtype}): ${why}`);
  }
  return o.schema.parse(result.structured_output);
}

/** Claude refused for a limit: treat the window as full, wait for the reset, retry once. */
async function hitLimit<S extends z.ZodType>(o: AskOpts<S>, retried: boolean, msg: string): Promise<z.infer<S>> {
  if (!cfg.resumeAfterReset || retried) throw new UsageLimitError(msg);
  planUsage.fiveHour = Math.max(planUsage.fiveHour ?? 0, 100);
  return askNow(o, true);
}

// The CLI's validator rejects the "$schema" meta key zod adds.
function jsonSchema(schema: z.ZodType) {
  const { $schema: _, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

async function firstResult(q: ReturnType<typeof query>) {
  // Ask for plan utilization at most every 2 minutes (experimental SDK API; events also report it).
  if (Date.now() - planUsage.checkedAt > 120_000) {
    planUsage.checkedAt = Date.now();
    q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })
      .then((u) => noteUsage(u.rate_limits?.five_hour?.utilization, u.rate_limits?.five_hour?.resets_at))
      .catch(() => {});
  }
  for await (const m of q) {
    if (m.type === "rate_limit_event" && m.rate_limit_info.rateLimitType === "five_hour") noteUsage(m.rate_limit_info.utilization, m.rate_limit_info.resetsAt);
    if (m.type === "result") return m as Extract<typeof m, { type: "result" }> & { api_error_status?: number | null; result?: string };
  }
  throw new Error("Claude session ended without a result");
}
