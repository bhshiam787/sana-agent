// Adds starter links (position boards, scholarships, research tools). Safe to re-run.
import "dotenv/config";
import { db, t } from "../src/db";

const links = [
  ["Position boards", "EURAXESS jobs (EU research positions)", "https://euraxess.ec.europa.eu/jobs/search"],
  ["Position boards", "FindAPhD", "https://www.findaphd.com"],
  ["Position boards", "AcademicPositions", "https://academicpositions.com"],
  ["Position boards", "jobs.ac.uk (UK)", "https://www.jobs.ac.uk"],
  ["Scholarships", "DAAD scholarships (Germany)", "https://www.daad.de/en/study-and-research-in-germany/scholarships/"],
  ["Scholarships", "Erasmus Mundus catalogue (fully funded joint masters)", "https://www.eacea.ec.europa.eu/scholarships/erasmus-mundus-catalogue_en"],
  ["Scholarships", "Chevening (UK masters)", "https://www.chevening.org/scholarships/"],
  ["Scholarships", "Commonwealth Scholarships (UK)", "https://cscuk.fcdo.gov.uk/scholarships/"],
  ["Scholarships", "Swedish Institute scholarships", "https://si.se/en/apply/scholarships/"],
  ["Scholarships", "Study in Japan (MEXT info)", "https://www.studyinjapan.go.jp/en/"],
  ["Research tools", "OpenAlex (researchers, papers)", "https://openalex.org"],
  ["Research tools", "Google Scholar", "https://scholar.google.com"],
  ["Research tools", "Semantic Scholar", "https://www.semanticscholar.org"],
] as const;

const existing = new Set((await db.select({ url: t.links.url }).from(t.links)).map((r) => r.url));
const fresh = links.filter(([, , url]) => !existing.has(url));
if (fresh.length) await db.insert(t.links).values(fresh.map(([category, title, url]) => ({ category, title, url })));
console.log(`Added ${fresh.length} links.`);
process.exit(0);
