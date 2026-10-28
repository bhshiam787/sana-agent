import { readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const AGENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ROOT = path.resolve(AGENT_DIR, "..");

// DATABASE_URL lives in web/.env; agent-only secrets (Gmail) in agent/.env.
loadEnv({ path: path.join(ROOT, "web/.env"), quiet: true });
loadEnv({ path: path.join(AGENT_DIR, ".env"), quiet: true });

const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);

/**
 * Run modes. "economy" (default) uses Sonnet for bulk work, fewer parallel
 * sessions and per-run caps; "medium" doubles the volume and scores professors
 * on Opus; "max" is the original all-Opus, uncapped setup.
 * Pick with `--mode medium|max` or AGENT_MODE; any single env var below still overrides.
 */
const argMode = process.argv.includes("--mode") ? process.argv[process.argv.indexOf("--mode") + 1] : undefined;
const wanted = argMode ?? process.env.AGENT_MODE;
export const MODE: "economy" | "medium" | "max" = wanted === "max" || wanted === "medium" ? wanted : "economy";
type Preset = {
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
// Shared with the dashboard's Run modes page.
const PRESETS: Record<typeof MODE, Preset> = JSON.parse(readFileSync(path.join(AGENT_DIR, "modes.json"), "utf8"));
const P = PRESETS[MODE];

export const cfg = {
  mode: MODE,
  // Dossier, writer, reviewer, strategist, learner: quality matters most.
  qualityModel: process.env.CLAUDE_MODEL ?? P.qualityModel,
  // Finders, faculty sweeps, profiler, inbox classification: high volume.
  bulkModel: process.env.CLAUDE_BULK_MODEL ?? P.bulkModel,
  // Profiler: fit/funding scoring decides who is shortlisted.
  profileModel: process.env.CLAUDE_PROFILE_MODEL ?? P.profileModel,
  positionSessions: num(process.env.POSITION_SESSIONS, P.positionSessions),
  labCountries: num(process.env.LAB_COUNTRIES, P.labCountries),
  sweepsPerRun: num(process.env.SWEEPS_PER_RUN, P.sweepsPerRun),
  researchPerRun: num(process.env.RESEARCH_PER_RUN, P.researchPerRun),
  gmailUser: process.env.GMAIL_USER ?? "",
  gmailAppPassword: (process.env.GMAIL_APP_PASSWORD ?? "").replace(/\s+/g, ""),
  senderName: process.env.SENDER_NAME ?? "Tamanna Zubairi Sana",
  // Login email of the dashboard user starting the run (shown as "started by").
  runAs: process.env.RUN_AS ?? "",
  nightlyEmailCap: num(process.env.NIGHTLY_EMAIL_CAP, 20),
  // Claude sessions running at once (finders, profiler, researcher, writer).
  parallel: num(process.env.PARALLEL, P.parallel),
  // Stop starting new Claude sessions once the 5-hour plan window is this full (percent).
  usageStopPercent: num(process.env.USAGE_STOP_PERCENT, 85),
  // Wait for the 5-hour window to reset and continue, instead of ending the run.
  resumeAfterReset: process.env.RESUME_AFTER_RESET !== "0",
  scoutPerQuery: num(process.env.SCOUT_PER_QUERY, 40),
  profilePerRun: num(process.env.PROFILE_PER_RUN, P.profilePerRun),
  shortlistMin: num(process.env.SHORTLIST_MIN_PRIORITY, 60),
  sendGapMinutes: [num(process.env.SEND_GAP_MIN, 4), num(process.env.SEND_GAP_MAX, 11)] as const,
  followUpDays: num(process.env.FOLLOW_UP_DAYS, 12),
  linkedinEnabled: process.env.LINKEDIN_ENABLED === "1",
  linkedinMaxPages: num(process.env.LINKEDIN_MAX_PAGES, 40),
  openalexMailto: process.env.OPENALEX_MAILTO ?? "",
  openalexApiKey: process.env.OPENALEX_API_KEY ?? "",
  // Stop starting new work after this many hours (sending continues to the cap).
  runHours: num(process.env.RUN_HOURS, 8),
  cvPath: path.join(ROOT, "profile/Tamanna_Zubairi_Sana_CV.pdf"),
  profilePath: path.join(ROOT, "profile/profile.md"),
  targetsPath: path.join(AGENT_DIR, "targets.json"),
  skillsDir: path.join(AGENT_DIR, "skills"),
  browserProfile: path.join(AGENT_DIR, "browser-profile"),
  workDir: path.join(AGENT_DIR, "state"),
};
