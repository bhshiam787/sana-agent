import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const AGENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ROOT = path.resolve(AGENT_DIR, "..");

// DATABASE_URL lives in web/.env; agent-only secrets (Gmail) in agent/.env.
loadEnv({ path: path.join(ROOT, "web/.env"), quiet: true });
loadEnv({ path: path.join(AGENT_DIR, ".env"), quiet: true });

const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);

export const cfg = {
  model: process.env.CLAUDE_MODEL ?? "claude-opus-5-5",
  gmailUser: process.env.GMAIL_USER ?? "",
  gmailAppPassword: (process.env.GMAIL_APP_PASSWORD ?? "").replace(/\s+/g, ""),
  senderName: process.env.SENDER_NAME ?? "Tamanna Zubairi Sana",
  // Login email of the dashboard user starting the run (shown as "started by").
  runAs: process.env.RUN_AS ?? "",
  nightlyEmailCap: num(process.env.NIGHTLY_EMAIL_CAP, 20),
  // Claude sessions running at once (finders, profiler, researcher, writer).
  parallel: num(process.env.PARALLEL, 16),
  // Stop starting new Claude sessions once the 5-hour plan window is this full (percent).
  usageStopPercent: num(process.env.USAGE_STOP_PERCENT, 85),
  // Wait for the 5-hour window to reset and continue, instead of ending the run.
  resumeAfterReset: process.env.RESUME_AFTER_RESET !== "0",
  scoutPerQuery: num(process.env.SCOUT_PER_QUERY, 40),
  profilePerRun: num(process.env.PROFILE_PER_RUN, 40),
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
