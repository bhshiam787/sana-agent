import { query, type McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { mkdirSync } from "node:fs";
import { z } from "zod";
import { cfg } from "./config.ts";
import { bump } from "./log.ts";
import { Semaphore } from "./sem.ts";

/** Thrown when the Claude plan's usage limit (or rate limit) stops the run. Next run resumes. */
export class UsageLimitError extends Error {}

type AskOpts<S extends z.ZodType> = {
  prompt: string;
  system: string;
  schema: S;
  /** Built-in tools to allow, e.g. ["WebSearch", "WebFetch"]. Everything else is denied. */
  tools?: string[];
  mcpServers?: Record<string, McpServerConfig>;
  maxTurns?: number;
  effort?: "low" | "medium" | "high";
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

/** Refuses new sessions once the 5-hour window passes USAGE_STOP_PERCENT; in-flight sessions finish. */
function checkBudget() {
  if (planUsage.fiveHour != null && planUsage.fiveHour >= cfg.usageStopPercent) {
    const reset = planUsage.resetsAt ? ` (window resets ${new Date(planUsage.resetsAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })})` : "";
    throw new UsageLimitError(`5-hour Claude usage at ${Math.round(planUsage.fiveHour)}%, stop threshold ${cfg.usageStopPercent}%${reset}`);
  }
}

async function askNow<S extends z.ZodType>(o: AskOpts<S>): Promise<z.infer<S>> {
  checkBudget();
  mkdirSync(cfg.workDir, { recursive: true });
  const allowed = [...(o.tools ?? []), ...Object.keys(o.mcpServers ?? {}).map((s) => `mcp__${s}`)];
  let result: Awaited<ReturnType<typeof firstResult>>;
  try {
    result = await firstResult(
      query({
        prompt: o.prompt,
        options: {
          model: cfg.model,
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
    if (LIMIT_RE.test(msg)) throw new UsageLimitError(msg);
    throw e;
  }
  bump("claude_calls");
  if (result.subtype !== "success" || result.is_error) {
    const why = "errors" in result ? result.errors.join("; ") : result.result;
    if (result.api_error_status === 429 || LIMIT_RE.test(why ?? "")) throw new UsageLimitError(why);
    throw new Error(`Claude session failed (${result.subtype}): ${why}`);
  }
  return o.schema.parse(result.structured_output);
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
