import { readFileSync } from "node:fs";
import path from "node:path";
import { cfg } from "./config.ts";

export const skill = (name: string) => readFileSync(path.join(cfg.skillsDir, `${name}.md`), "utf8");
export const applicantProfile = () => readFileSync(cfg.profilePath, "utf8");

export type Targets = {
  researchQueries: string[];
  excludeCountries: string[];
  preferCountries: string[];
  minHIndex: number;
  maxHIndex: number;
  publishedSince: string;
};
export const targets = (): Targets => JSON.parse(readFileSync(cfg.targetsPath, "utf8"));

export type Scoring = {
  weights: { fit: number; funding: number; reply: number };
  salariedPhdCountries: string[];
  replyBonus: { assistantProfessor: number; associateProfessor: number; recruiting: number; hIndexSweetSpot: number };
};
export const scoring = (): Scoring => JSON.parse(readFileSync(path.join(cfg.skillsDir, "scoring.json"), "utf8"));
