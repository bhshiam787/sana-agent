// Overnight run. Usage:
//   pnpm dry                               everything except sending (required once before live)
//   pnpm night                             live; keeps the Mac awake
//   pnpm run:agent --stages inbox,send     run only some stages, one after another (batch mode)
//
// Without --stages, all stages run at the same time as a pipeline: finders keep
// discovering while earlier finds are already being profiled, researched,
// written and sent. PARALLEL caps how many Claude sessions run at once.
import os from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { cfg } from "./config.ts";
import { db, t, and, eq, sql } from "./db.ts";
import { sessions, UsageLimitError } from "./llm.ts";
import { log, setRunId, stats } from "./log.ts";
import { mailConfigured, verifyMail } from "./mail.ts";
import { nextUniversity, seedUniversities, sweepUniversity } from "./stages/directory.ts";
import { scoutNsfGrants } from "./stages/grants.ts";
import { readReplies } from "./stages/inbox.ts";
import { learnFromRun, reweight } from "./stages/learn.ts";
import { strategize } from "./stages/strategist.ts";
import { scoutLinkedIn } from "./stages/linkedin.ts";
import { nextToProfile, profileOne, profileProfessors } from "./stages/profile.ts";
import { deepResearch, nextToResearch, researchOne } from "./stages/research.ts";
import { scoutOpenAlex, scoutPositions, scoutRecruitingLabs } from "./stages/scout.ts";
import { countReadyDrafts, sendDrafts, sendGap, sendNext, sentInLast20h } from "./stages/send.ts";
import { nextToWrite, writeEmails, writeFollowUps, writeOne, writeRoom } from "./stages/write.ts";

const FINDERS = ["scout", "nsf", "positions", "labs", "linkedin", "directory"] as const;
const ALL = ["inbox", "strategy", ...FINDERS, "profile", "research", "followups", "write", "send", "learn"] as const;
type Stage = (typeof ALL)[number];

function args() {
  const a = process.argv.slice(2);
  const get = (k: string) => {
    const i = a.indexOf(k);
    return i >= 0 ? a[i + 1] : undefined;
  };
  const stages = get("--stages")?.split(",") as Stage[] | undefined;
  const bad = (stages ?? []).filter((s) => !ALL.includes(s));
  if (bad.length) throw new Error(`Unknown stage(s): ${bad.join(", ")}. Valid: ${ALL.join(", ")}`);
  if (get("--cap")) cfg.nightlyEmailCap = Number(get("--cap"));
  if (get("--hours")) cfg.runHours = Number(get("--hours"));
  return { live: a.includes("--live"), force: a.includes("--force"), stages };
}

let stopped: UsageLimitError | null = null;

/** Workers that keep pulling items until upstream is finished and nothing is left. */
async function stage<T>(o: {
  name: string;
  workers: number;
  deadline: number;
  next: (inFlight: Set<number>) => Promise<T | null>;
  id: (item: T) => number;
  run: (item: T) => Promise<void>;
  upstreamDone: () => boolean;
  gate?: () => Promise<boolean>;
}) {
  const inFlight = new Set<number>();
  let lock = Promise.resolve();
  // Claim under a lock so two workers never take the same item.
  const claim = () => {
    const p = lock.then(async () => {
      const item = await o.next(inFlight);
      if (item) inFlight.add(o.id(item));
      return item;
    });
    lock = p.then(
      () => undefined,
      () => undefined,
    );
    return p;
  };
  const worker = async () => {
    while (!stopped && Date.now() < o.deadline) {
      if (o.gate && !(await o.gate())) {
        if (o.upstreamDone()) return;
        await sleep(30_000);
        continue;
      }
      const item = await claim();
      if (!item) {
        if (o.upstreamDone() && inFlight.size === 0) return;
        await sleep(20_000);
        continue;
      }
      try {
        await o.run(item);
      } catch (e) {
        if (e instanceof UsageLimitError) stopped = e;
        else await log("run", `${o.name} error: ${(e as Error).message}`, { level: "warn" });
      } finally {
        inFlight.delete(o.id(item));
      }
    }
  };
  await Promise.all(Array.from({ length: o.workers }, worker));
}

async function pipeline(runId: number, dryRun: boolean) {
  const deadline = Date.now() + cfg.runHours * 3600_000;
  const done = { finders: false, profile: false, research: false, write: false };
  const w = (share: number) => Math.max(1, Math.round(cfg.parallel * share));
  const settle = async (name: string, f: () => Promise<void>) => {
    try {
      await f();
    } catch (e) {
      if (e instanceof UsageLimitError) stopped = e;
      else await log("scout", `${name} failed: ${(e as Error).message}`, { level: "warn" });
    }
  };

  // Track A (advertised) and Track B (silent funding) finders, all at once.
  const finders = (async () => {
    await Promise.all([
      settle("openalex", scoutOpenAlex),
      settle("nsf", scoutNsfGrants),
      settle("positions", scoutPositions),
      settle("labs", scoutRecruitingLabs),
      settle("linkedin", scoutLinkedIn),
      settle("directory", async () => {
        await seedUniversities();
        await stage({ name: "directory", workers: w(0.3), deadline, next: nextUniversity, id: (u) => u.id, run: sweepUniversity, upstreamDone: () => true });
      }),
    ]);
    done.finders = true;
    await log("scout", "All finders finished");
  })();

  const profile = stage({
    name: "profile",
    workers: w(0.4),
    deadline,
    next: async (f) => (await nextToProfile(f, 1))[0] ?? null,
    id: (r) => r.p.id,
    run: profileOne,
    upstreamDone: () => done.finders,
  }).then(() => (done.profile = true));

  const research = stage({
    name: "research",
    workers: w(0.3),
    deadline,
    next: async (f) => (await nextToResearch(f, 1))[0] ?? null,
    id: (r) => r.p.id,
    run: researchOne,
    upstreamDone: () => done.profile,
  }).then(() => (done.research = true));

  const write = stage({
    name: "write",
    workers: w(0.25),
    deadline,
    gate: async () => (await writeRoom()) > 0,
    next: async (f) => (await nextToWrite(f, 1))[0] ?? null,
    id: (p) => p.id,
    run: writeOne,
    upstreamDone: () => done.research,
  }).then(() => (done.write = true));

  // Sender: one email at a time, spaced out, while everything else keeps working.
  const send = (async () => {
    if (dryRun) return;
    while (!stopped) {
      if ((await sentInLast20h()) >= cfg.nightlyEmailCap) {
        await log("sender", `Nightly cap of ${cfg.nightlyEmailCap} reached`);
        return;
      }
      const r = await sendNext(runId);
      if (r === "auth") return;
      if (r === "none") {
        if (done.write) return;
        await sleep(60_000);
      } else if (r === "sent") await sleep(sendGap());
    }
  })();

  // Strategist re-plans every 90 minutes; its changes apply to work picked up afterwards.
  const replan = (async () => {
    while (!stopped && !(done.finders && done.profile && done.research && done.write)) {
      for (let i = 0; i < 90 && !(done.finders && done.profile && done.research && done.write); i++) await sleep(60_000);
      if (done.write) return;
      await settle("strategist", () => strategize(runId));
    }
  })();

  // Progress line every 10 minutes so the terminal shows it is alive.
  const ticker = setInterval(() => {
    console.log(`[progress] Claude sessions ${sessions.active}/${cfg.parallel} · ${Object.entries(stats).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  }, 600_000);
  try {
    await Promise.all([finders, profile, research, write, send, replan]);
  } finally {
    clearInterval(ticker);
  }
  if (stopped) throw stopped;
}

async function batch(stages: Stage[], runId: number, dryRun: boolean) {
  const has = (s: Stage) => stages.includes(s);
  if (has("inbox")) await readReplies();
  if (has("strategy")) await strategize(runId);
  const finders: [Stage, () => Promise<void>][] = [
    ["scout", scoutOpenAlex],
    ["nsf", scoutNsfGrants],
    ["positions", scoutPositions],
    ["labs", scoutRecruitingLabs],
    ["linkedin", scoutLinkedIn],
    [
      "directory",
      async () => {
        await seedUniversities();
        const unis = [];
        for (let i = 0; i < cfg.parallel; i++) {
          const u = await nextUniversity(new Set(unis.map((x) => x.id)));
          if (!u) break;
          unis.push(u);
        }
        await Promise.all(unis.map(sweepUniversity));
      },
    ],
  ];
  const results = await Promise.allSettled(finders.filter(([s]) => has(s)).map(([, f]) => f()));
  for (const r of results) if (r.status === "rejected" && r.reason instanceof UsageLimitError) throw r.reason;
  if (has("profile")) await profileProfessors();
  if (has("research")) await deepResearch();
  if (has("followups")) await writeFollowUps();
  if (has("write")) await writeEmails();
  if (has("send")) await sendDrafts({ dryRun, runId });
  if (has("learn")) {
    await learnFromRun(runId);
    await reweight(runId);
  }
}

async function main() {
  const { live, force, stages } = args();
  const dryRun = !live;

  if (live) {
    const [dry] = await db
      .select({ id: t.agentRuns.id })
      .from(t.agentRuns)
      .where(and(eq(t.agentRuns.dryRun, true), eq(t.agentRuns.status, "completed"), sql`(${t.agentRuns.stats} ->> 'would_send')::int > 0`))
      .limit(1);
    if (!dry) {
      console.error("No full dry run with drafted emails yet. Run `pnpm dry` first and read the drafts on the dashboard.");
      process.exit(1);
    }
  }
  // Two machines share one database: only one run at a time.
  const [other] = await db
    .select({ id: t.agentRuns.id, machine: t.agentRuns.machine })
    .from(t.agentRuns)
    .where(and(eq(t.agentRuns.status, "running"), sql`${t.agentRuns.startedAt} > now() - interval '12 hours'`))
    .limit(1);
  if (other && !force) {
    console.error(`Run #${other.id} is already running on ${other.machine}. Wait for it, or pass --force if it crashed.`);
    process.exit(1);
  }
  // A dry run sends nothing, so it may run before Gmail is set up (inbox is skipped).
  const needsMail = live || stages?.includes("inbox");
  const mailOn = mailConfigured();
  if (needsMail) {
    if (!mailConfigured()) {
      console.error("Gmail is not set up. Fill GMAIL_USER and GMAIL_APP_PASSWORD in agent/.env (see agent/.env.example).");
      process.exit(1);
    }
    await verifyMail();
  } else if (mailOn) await verifyMail();

  const [user] = cfg.runAs ? await db.select({ id: t.users.id }).from(t.users).where(eq(t.users.email, cfg.runAs.toLowerCase())) : [];
  const [run] = await db.insert(t.agentRuns).values({ startedBy: user?.id ?? null, machine: os.hostname().replace(/\.local$/, ""), dryRun }).returning();
  setRunId(run.id);
  await log(
    "run",
    `Run #${run.id} started (${dryRun ? "DRY RUN — nothing will be sent" : "LIVE"}), ${stages ? `stages: ${stages.join(", ")}` : `full pipeline, ${cfg.parallel} parallel Claude sessions, ${cfg.runHours}h`}`,
  );

  let status: "completed" | "stopped" | "failed" = "completed";
  let error: string | null = null;
  try {
    if (stages) await batch(stages, run.id, dryRun);
    else {
      if (mailOn) await readReplies();
      else await log("inbox", "Gmail not set up yet: inbox check skipped (dry run)", { level: "warn" });
      await strategize(run.id);
      await writeFollowUps();
      await pipeline(run.id, dryRun);
      if (mailOn) await readReplies();
      if (dryRun) stats.would_send = await countReadyDrafts();
      await learnFromRun(run.id);
      await reweight(run.id);
      await strategize(run.id);
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
    `Found ${stats.professors_found ?? 0} professors and ${stats.positions_found ?? 0} positions; swept ${stats.universities_swept ?? 0} universities.`,
    `Researched ${stats.researched ?? 0} (${stats.shortlisted ?? 0} shortlisted, ${stats.deep_researched ?? 0} deep dossiers).`,
    dryRun ? `${stats.would_send ?? 0} emails drafted and waiting.` : `Sent ${stats.emails_sent ?? 0} emails and ${stats.follow_ups_sent ?? 0} follow-ups.`,
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
