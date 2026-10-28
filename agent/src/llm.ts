import { query, type McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { mkdirSync } from "node:fs";
import { z } from "zod";
import { cfg } from "./config.ts";
import { bump } from "./log.ts";

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
export async function ask<S extends z.ZodType>(o: AskOpts<S>): Promise<z.infer<S>> {
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
  for await (const m of q) {
    if (m.type === "result") return m as Extract<typeof m, { type: "result" }> & { api_error_status?: number | null; result?: string };
  }
  throw new Error("Claude session ended without a result");
}
