// Overnight run. Usage:
//   pnpm dry           research + write drafts, send nothing (required once before going live)
//   pnpm night         full live run (keeps the Mac awake)
//   pnpm run:agent -- --stages inbox,send --cap 5
import os from "node:os";
import { cfg } from "./config.ts";
import { db, t, and, eq, sql } from "./db.ts";
import { UsageLimitError } from "./llm.ts";
import { log, setRunId, stats } from "./log.ts";
import { mailConfigured, verifyMail } from "./mail.ts";
import { readReplies } from "./stages/inbox.ts";
import { applyApprovedLearnings, proposeLearnings, proposeWeights } from "./stages/learn.ts";
import { scoutLinkedIn } from "./stages/linkedin.ts";
import { profileProfessors } from "./stages/profile.ts";
import { deepResearch } from "./stages/research.ts";
import { scoutOpenAlex, scoutPositions, scoutRecruitingLabs } from "./stages/scout.ts";
import { sendDrafts } from "./stages/send.ts";
import { writeEmails, writeFollowUps } from "./stages/write.ts";

const FINDERS = ["scout", "positions", "labs", "linkedin"] as const;
const ALL = ["inbox", "learn-apply", ...FINDERS, "profile", "research", "write", "followups", "send", "learn"] as const;
type Stage = (typeof ALL)[number];

function args() {
  const a = process.argv.slice(2);
  const get = (k: string) => {
    const i = a.indexOf(k);
    return i >= 0 ? a[i + 1] : undefined;
  };
  const stages = (get("--stages")?.split(",") as Stage[] | undefined) ?? [...ALL];
  const bad = stages.filter((s) => !ALL.includes(s));
  if (bad.length) throw new Error(`Unknown stage(s): ${bad.join(", ")}. Valid: ${ALL.join(", ")}`);
  if (get("--cap")) cfg.nightlyEmailCap = Number(get("--cap"));
  return { live: a.includes("--live"), stages };
}

async function main() {
  const { live, stages } = args();
  const dryRun = !live;

  if (live) {
    const [dry] = await db.select({ id: t.agentRuns.id }).from(t.agentRuns).where(and(eq(t.agentRuns.dryRun, true), eq(t.agentRuns.status, "completed"), sql`(${t.agentRuns.stats} ->> 'would_send')::int > 0`)).limit(1);
    if (!dry) {
      console.error("No full dry run with drafted emails yet. Run `pnpm dry` first and read the drafts on the dashboard.");
      process.exit(1);
    }
  }
  const needsMail = stages.some((s) => s === "inbox" || (s === "send" && live));
  if (needsMail) {
    if (!mailConfigured()) {
      console.error("Gmail is not set up. Fill GMAIL_USER and GMAIL_APP_PASSWORD in agent/.env (see agent/.env.example).");
      process.exit(1);
    }
    await verifyMail();
  }

  const [user] = cfg.runAs ? await db.select({ id: t.users.id }).from(t.users).where(eq(t.users.email, cfg.runAs.toLowerCase())) : [];
  const [run] = await db.insert(t.agentRuns).values({ startedBy: user?.id ?? null, machine: os.hostname().replace(/\.local$/, ""), dryRun }).returning();
  setRunId(run.id);
  await log("run", `Run #${run.id} started (${dryRun ? "DRY RUN — nothing will be sent" : "LIVE"}), stages: ${stages.join(", ")}`);

  let status: "completed" | "stopped" | "failed" = "completed";
  let error: string | null = null;
  const has = (s: Stage) => stages.includes(s);
  try {
    if (has("inbox")) await readReplies();
    if (has("learn-apply")) await applyApprovedLearnings();
    // All finders run at the same time; one failing does not stop the others.
    const finders: Record<(typeof FINDERS)[number], () => Promise<void>> = {
      scout: scoutOpenAlex,
      positions: scoutPositions,
      labs: scoutRecruitingLabs,
      linkedin: scoutLinkedIn,
    };
    const results = await Promise.allSettled(FINDERS.filter(has).map((f) => finders[f]()));
    for (const r of results) {
      if (r.status === "rejected") {
        if (r.reason instanceof UsageLimitError) throw r.reason;
        await log("scout", `A finder failed: ${(r.reason as Error).message}`, { level: "warn" });
      }
    }
    if (has("profile")) await profileProfessors();
    if (has("research")) await deepResearch();
    if (has("followups")) await writeFollowUps();
    if (has("write")) await writeEmails();
    if (has("send")) await sendDrafts({ dryRun, runId: run.id });
    if (has("learn")) {
      await proposeLearnings(run.id);
      await proposeWeights(run.id);
    }
  } catch (e) {
    if (e instanceof UsageLimitError) {
      status = "stopped";
      error = `Stopped: Claude usage limit reached. Progress is saved; the next run continues. (${e.message})`;
    } else {
      status = "failed";
      error = (e as Error).stack ?? String(e);
    }
    await log("run", error.split("\n")[0], { level: status === "failed" ? "error" : "warn" });
  }

  const summary = [
    dryRun ? "Dry run: nothing was sent." : null,
    `Found ${stats.professors_found ?? 0} professors and ${stats.positions_found ?? 0} positions, researched ${stats.researched ?? 0} (${stats.shortlisted ?? 0} shortlisted).`,
    dryRun ? `${stats.would_send ?? 0} emails are drafted and waiting.` : `Sent ${stats.emails_sent ?? 0} emails and ${stats.follow_ups_sent ?? 0} follow-ups.`,
    `Reviewer blocked ${stats.blocked_by_reviewer ?? 0}. New replies: ${stats.replies_received ?? 0}.`,
  ]
    .filter(Boolean)
    .join(" ");
  await db.update(t.agentRuns).set({ status, endedAt: new Date(), stats, summary, error }).where(eq(t.agentRuns.id, run.id));
  await log("run", `Run #${run.id} ${status}. ${summary}`);
  process.exit(status === "failed" ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
