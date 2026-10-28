import { existsSync } from "node:fs";
import { cfg } from "../config.ts";
import { ask } from "../llm.ts";
import { log } from "../log.ts";
import { applicantProfile, skill, targets } from "../skills.ts";
import { PositionsOut, savePositions } from "./scout.ts";

/** Reads LinkedIn posts about funded PhD positions in the logged-in browser profile. Read-only. */
export async function scoutLinkedIn() {
  if (!cfg.linkedinEnabled) return;
  if (!existsSync(cfg.browserProfile)) {
    await log("linkedin", "Skipped: no browser profile. Run `pnpm linkedin:login` once and sign in.", { level: "warn" });
    return;
  }
  const tg = targets();
  const out = await ask({
    system: `You browse LinkedIn in a real, logged-in browser to find funded PhD positions. You are strictly read-only.\n\n${skill("linkedin")}`,
    prompt: `Applicant profile:\n${applicantProfile()}\n\nTopics: ${tg.researchQueries.join("; ")}.\nPage budget: at most ${cfg.linkedinMaxPages} page loads.\nToday is ${new Date().toISOString().slice(0, 10)}.\n\nSearch LinkedIn posts for open funded PhD positions on these topics and return them. If you hit a login wall, CAPTCHA or warning, stop and say so in notes.`,
    schema: PositionsOut,
    mcpServers: {
      playwright: {
        command: "npx",
        args: ["-y", "@playwright/mcp@latest", "--browser", "chromium", "--user-data-dir", cfg.browserProfile],
      },
    },
    maxTurns: cfg.linkedinMaxPages * 3,
  });
  await savePositions(out.positions.map((p) => ({ ...p, source: "linkedin" })), "linkedin");
  if (out.notes) await log("linkedin", out.notes, { level: /captcha|unusual|login|restrict|blocked/i.test(out.notes) ? "warn" : "info" });
}
