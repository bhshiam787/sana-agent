import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./config.ts";

type Ref = { n: number; authors: string[]; title: string };

let refs: Ref[] | null = null;
const load = (): Ref[] =>
  (refs ??= existsSync(path.join(ROOT, "profile/papers/fl_review_references.json"))
    ? JSON.parse(readFileSync(path.join(ROOT, "profile/papers/fl_review_references.json"), "utf8"))
    : []);

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z\s-]/g, "").trim();

/**
 * Works by this person that Tamanna's IEEE Access review cites (matched on
 * surname + first initial). "I cited your paper X in my review" is a true,
 * strong opening line.
 */
export function citedWorksBy(fullName: string) {
  const parts = norm(fullName).split(/\s+/).filter(Boolean);
  if (parts.length < 2) return [];
  const last = parts[parts.length - 1];
  const initial = parts[0][0];
  return load().filter((r) =>
    r.authors.some((a) => {
      const ap = norm(a).split(/\s+/).filter(Boolean);
      return ap.length >= 2 && ap[ap.length - 1] === last && ap[0][0] === initial;
    }),
  );
}

export function citationNote(fullName: string) {
  const works = citedWorksBy(fullName);
  return works.length
    ? `Tamanna's IEEE Access 2025 review cites this professor's work: ${works.map((w) => `[${w.n}] "${w.title}"`).join("; ")}. Verify the person is the same author before using it.`
    : "";
}
