import { readFileSync } from "node:fs";
import path from "node:path";
import { cfg } from "./config.ts";

export const skill = (name: string) => readFileSync(path.join(cfg.skillsDir, `${name}.md`), "utf8");
export const applicantProfile = () => readFileSync(cfg.profilePath, "utf8");

export type Targets = {
  researchQueries: string[];
  grantKeywords: string[];
  allowCountries: string[];
  excludeCountries: string[];
  universitiesPerCountry: number;
  departments: string[];
  wealthyUniversities: { name: string; country: string }[];
  warmContacts: { name: string; note: string }[];
  preferCountries: string[];
  minHIndex: number;
  maxHIndex: number;
  publishedSince: string;
};
export type Strategy = {
  addQueries: string[];
  dropQueries: string[];
  addGrantKeywords: string[];
  countryPriority: string[];
  countryBoost: Record<string, number>;
  topicBoost: Record<string, number>;
  updatedAt: string | null;
  lastAssessment: string | null;
};
export const strategyPath = () => path.join(path.dirname(cfg.targetsPath), "strategy.json");
export const strategy = (): Strategy => JSON.parse(readFileSync(strategyPath(), "utf8"));

/** Human targets (targets.json) with the strategist's current focus layered on top. Re-read on every call, so changes apply mid-run. */
export const targets = (): Targets => {
  const base: Targets = JSON.parse(readFileSync(cfg.targetsPath, "utf8"));
  const s = strategy();
  const drop = new Set(s.dropQueries.map((q) => q.toLowerCase()));
  return {
    ...base,
    researchQueries: [...new Set([...base.researchQueries, ...s.addQueries])].filter((q) => !drop.has(q.toLowerCase())),
    grantKeywords: [...new Set([...base.grantKeywords, ...s.addGrantKeywords])],
    preferCountries: s.countryPriority.length ? s.countryPriority : base.preferCountries,
  };
};

/** Strategist's extra priority points for a professor's country and research areas (bounded ±10). */
export function focusBonus(country: string | null, areas: string[] | null) {
  const s = strategy();
  const c = country ? (s.countryBoost[country] ?? 0) : 0;
  const lower = (areas ?? []).map((a) => a.toLowerCase());
  const topic = Math.max(0, ...Object.entries(s.topicBoost).filter(([k]) => lower.some((a) => a.includes(k.toLowerCase()) || k.toLowerCase().includes(a))).map(([, v]) => v));
  return Math.max(-10, Math.min(10, c + topic));
}

export type Scoring = {
  weights: { fit: number; funding: number; reply: number };
  salariedPhdCountries: string[];
  replyBonus: { assistantProfessor: number; associateProfessor: number; recruiting: number; hIndexSweetSpot: number };
};
export const scoring = (): Scoring => JSON.parse(readFileSync(path.join(cfg.skillsDir, "scoring.json"), "utf8"));
