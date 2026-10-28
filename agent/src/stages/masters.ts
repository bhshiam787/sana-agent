import { z } from "zod";
import { cfg } from "../config.ts";
import { db, t } from "../db.ts";
import { ask, UsageLimitError } from "../llm.ts";
import { bump, log } from "../log.ts";
import { countryAllowed, upsertUniversity } from "../professors.ts";
import { applicantProfile, targets } from "../skills.ts";

const MastersOut = z.object({
  items: z.array(
    z.object({
      title: z.string().describe("Scholarship or programme name"),
      kind: z.enum(["scholarship", "masters"]).describe("scholarship = funding you apply for; masters = a programme that itself is fully funded"),
      provider: z.string().describe("Funder or university"),
      country: z.string().nullable().describe("ISO code of the study country; null if many"),
      coverage: z.string().describe("Exactly what is paid: tuition, monthly stipend amount, health insurance, travel"),
      fullyFunded: z.boolean().describe("true only if BOTH full tuition AND a living stipend are covered"),
      openToBangladesh: z.boolean().describe("true only if Bangladeshi citizens are eligible"),
      fieldFits: z.boolean().describe("true if CS / AI / data science / cybersecurity masters are covered"),
      deadline: z.string().nullable().describe("Next deadline YYYY-MM-DD, or null if not announced"),
      url: z.string().describe("Official page"),
      requirements: z.string().describe("Documents and conditions (e.g. IELTS 6.5, 2 references, motivation letter)"),
    }),
  ),
});

const SEARCHES = [
  "Major fully funded government and international scholarships for a masters in computer science / AI / cybersecurity open to Bangladeshi citizens (e.g. Erasmus Mundus joint masters, DAAD EPOS, Chevening, Commonwealth, MEXT, Swedish Institute SISGP, Australia Awards, Fulbright Foreign Student, Global Korea Scholarship, Stipendium Hungaricum, Türkiye Burslari, Holland Scholarship)",
  "University-funded full scholarships (tuition + living stipend) for international masters students in computer science, data science, AI or cybersecurity at well-funded universities",
  "Fully funded research masters (MPhil / MRes / MSc by research / research training programme) in machine learning or cybersecurity where tuition and a stipend are covered",
  "Funded masters positions with a stipend in machine learning / security (e.g. Nordic and Dutch funded programmes, EU-funded master tracks, Swiss excellence masters scholarships)",
];

/**
 * Funded-masters track: scholarships and fully funded programmes. Never
 * emailed; saved as positions marked needs_manual with the deadline.
 */
export async function scoutFundedMasters() {
  const tg = targets();
  const profile = applicantProfile();
  const today = new Date().toISOString().slice(0, 10);
  await Promise.all(
    SEARCHES.slice(0, cfg.mastersSessions).map(async (focus) => {
      try {
        const out = await ask({
          tier: "bulk",
          system:
            "You find FULLY funded masters options (full tuition AND a living stipend) for one applicant. Verify each on its official page. Drop anything partial (tuition-only, fee discounts, loans) or not open to Bangladeshi citizens.",
          prompt: `Applicant:\n${profile}\n\nFocus: ${focus}\nPreferred study countries (ISO): ${tg.allowCountries.join(", ")}.\nToday is ${today}.\n\nReturn up to 12 options whose next deadline is in the future or not yet announced.`,
          schema: MastersOut,
          tools: ["WebSearch", "WebFetch"],
          maxTurns: 30,
        });
        let added = 0;
        for (const m of out.items) {
          if (!m.fullyFunded || !m.openToBangladesh || !m.fieldFits || !/^https?:\/\//.test(m.url)) continue;
          if (m.deadline && /^\d{4}-\d{2}-\d{2}$/.test(m.deadline) && m.deadline < today) continue;
          const universityId = m.kind === "masters" && m.country && countryAllowed(m.country) ? await upsertUniversity(m.provider, m.country) : null;
          const row = await db
            .insert(t.positions)
            .values({
              title: m.title,
              kind: m.kind,
              universityId,
              country: m.country,
              funding: m.coverage,
              deadline: m.deadline && /^\d{4}-\d{2}-\d{2}$/.test(m.deadline) ? m.deadline : null,
              url: m.url,
              source: `masters: ${m.provider}`,
              // Formal applications only: no outreach email for the masters track.
              status: "needs_manual",
              notes: `Requirements: ${m.requirements}`,
            })
            .onConflictDoNothing()
            .returning({ id: t.positions.id });
          if (row.length) added++;
        }
        bump("masters_found", added);
        await log("scout", `Funded masters: ${out.items.length} checked, ${added} new fully funded options`);
      } catch (e) {
        if (e instanceof UsageLimitError) throw e;
        await log("scout", `Funded masters search failed: ${(e as Error).message}`, { level: "warn" });
      }
    }),
  );
}
