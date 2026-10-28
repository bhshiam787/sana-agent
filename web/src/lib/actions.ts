"use server";

import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, t } from "@/db";
import { requireUser } from "./session";

type ProfStatus = (typeof t.professorStatus.enumValues)[number];
type PosStatus = (typeof t.positionStatus.enumValues)[number];

export async function updateProfessor(id: number, form: FormData) {
  await requireUser();
  const status = String(form.get("status")) as ProfStatus;
  await db
    .update(t.professors)
    .set({
      status: t.professorStatus.enumValues.includes(status) ? status : undefined,
      notes: String(form.get("notes") ?? ""),
      updatedAt: new Date(),
    })
    .where(eq(t.professors.id, id));
  revalidatePath(`/professors/${id}`);
}

export async function setPositionStatus(id: number, form: FormData) {
  await requireUser();
  const status = String(form.get("status")) as PosStatus;
  if (!t.positionStatus.enumValues.includes(status)) return;
  await db
    .update(t.positions)
    .set({ status, appliedAt: status === "applied" ? new Date() : undefined })
    .where(eq(t.positions.id, id));
  revalidatePath("/positions");
}

export async function toggleReplyHandled(id: number, handled: boolean) {
  await requireUser();
  await db.update(t.replies).set({ handled }).where(eq(t.replies.id, id));
  revalidatePath("/replies");
}

export async function decideLearning(id: number, approve: boolean) {
  await requireUser();
  await db
    .update(t.learnings)
    .set({ status: approve ? "approved" : "rejected", decidedAt: new Date() })
    .where(eq(t.learnings.id, id));
  revalidatePath("/learnings");
}

export async function addLink(form: FormData) {
  await requireUser();
  const title = String(form.get("title") ?? "").trim();
  const url = String(form.get("url") ?? "").trim();
  if (!title || !/^https?:\/\//.test(url)) return;
  await db.insert(t.links).values({
    title,
    url,
    category: String(form.get("category") ?? "general").trim() || "general",
    notes: String(form.get("notes") ?? "").trim() || null,
  });
  revalidatePath("/links");
}

export async function deleteLink(id: number) {
  await requireUser();
  await db.delete(t.links).where(eq(t.links.id, id));
  revalidatePath("/links");
}

/**
 * Puts the agent's playbooks/strategy back to the snapshot taken before this
 * change. Files are restored as a whole, so later changes are undone too.
 */
export async function revertLearning(id: number) {
  await requireUser();
  const [l] = await db.select().from(t.learnings).where(eq(t.learnings.id, id));
  if (!l?.snapshot) return;
  const { cpSync, existsSync, readdirSync } = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(process.cwd(), "..");
  const dir = path.join(root, l.snapshot);
  if (!dir.startsWith(path.join(root, "agent/skills/history")) || !existsSync(dir)) return;
  for (const f of readdirSync(dir)) {
    const dest = f === "strategy.json" ? path.join(root, "agent/strategy.json") : path.join(root, "agent/skills", f);
    cpSync(path.join(dir, f), dest);
  }
  await db
    .update(t.learnings)
    .set({ status: "reverted", decidedAt: new Date() })
    .where(and(gte(t.learnings.id, id), eq(t.learnings.status, "applied")));
  revalidatePath("/learnings");
}

const AGENT_DIR = () => `${process.cwd()}/../agent`;

/**
 * Starts the agent on this Mac (the dashboard and agent share a machine).
 * Returns an error message for the form, or undefined on success.
 */
export async function startRun(_prev: string | undefined, form: FormData) {
  const session = await requireUser();
  const live = form.get("mode") === "live";
  const runMode = ["medium", "max"].includes(String(form.get("runMode"))) ? String(form.get("runMode")) : "economy";
  const hours = Math.min(12, Math.max(0.5, Number(form.get("hours") ?? 8)));
  if (live && form.get("confirm") !== "yes") return "Tick the box to confirm a live run sends real emails.";

  const [busy] = await db
    .select({ id: t.agentRuns.id, machine: t.agentRuns.machine })
    .from(t.agentRuns)
    .where(and(inArray(t.agentRuns.status, ["running", "paused"]), sql`${t.agentRuns.startedAt} > now() - interval '12 hours'`));
  if (busy) return `Run #${busy.id} is already running on ${busy.machine ?? "another machine"}. Stop it first.`;

  const { existsSync, mkdirSync, openSync, readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const agentDir = AGENT_DIR();
  if (live) {
    const env = existsSync(path.join(agentDir, ".env")) ? readFileSync(path.join(agentDir, ".env"), "utf8") : "";
    if (!/^GMAIL_APP_PASSWORD="?[^"\s]{8,}/m.test(env)) return "Live runs need Gmail: add GMAIL_APP_PASSWORD to agent/.env first.";
    const [dry] = await db
      .select({ id: t.agentRuns.id })
      .from(t.agentRuns)
      .where(and(eq(t.agentRuns.dryRun, true), eq(t.agentRuns.status, "completed"), sql`(${t.agentRuns.stats} ->> 'would_send')::int > 0`))
      .limit(1);
    if (!dry) return "Do a complete dry run first and read its drafts.";
  }

  const [user] = await db.select({ email: t.users.email }).from(t.users).where(eq(t.users.id, session.userId));
  mkdirSync(path.join(agentDir, "state"), { recursive: true });
  const logFile = path.join(agentDir, "state", `run-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
  const out = openSync(logFile, "a");
  const { spawn } = await import("node:child_process");
  // caffeinate keeps the Mac awake for the length of the run.
  const child = spawn("caffeinate", ["-i", "npx", "tsx", "src/run.ts", ...(live ? ["--live"] : []), "--mode", runMode, "--hours", String(hours)], {
    cwd: agentDir,
    detached: true,
    stdio: ["ignore", out, out],
    // A clean environment: drop variables of whatever Claude Code session started this dashboard.
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDE_?CODE|CLAUDE_EFFORT|VSCODE_)/.test(k))), RUN_AS: user?.email ?? "" } as unknown as NodeJS.ProcessEnv,
  });
  child.unref();
  await new Promise((r) => setTimeout(r, 4000));
  revalidatePath("/");
  revalidatePath("/runs");
  return undefined;
}

/** Pause / resume / stop: written to the run row; the agent (on any machine) polls it. */
export async function controlRun(id: number, action: "pause" | "resume" | "stop") {
  await requireUser();
  await db.update(t.agentRuns).set({ control: action }).where(eq(t.agentRuns.id, id));
  revalidatePath("/");
  revalidatePath("/runs");
}

/** For a run whose process died (no activity, ignores Stop): mark it stopped so a new run can start. */
export async function forceStopRun(id: number) {
  await requireUser();
  await db
    .update(t.agentRuns)
    .set({ status: "stopped", endedAt: new Date(), control: null, error: "Marked stopped from the dashboard (process not responding)." })
    .where(eq(t.agentRuns.id, id));
  revalidatePath("/");
  revalidatePath("/runs");
}
