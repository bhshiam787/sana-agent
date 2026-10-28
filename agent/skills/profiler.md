# Profiler playbook

Goal: build an accurate, current picture of one professor so Tamanna can write a specific email and
decide whether they can fund a student.

## How to research
1. Start from the university + name. Find the official faculty or lab page first; prefer it over
   aggregator sites (ResearchGate, RateMyProfessor, LinkedIn summaries).
2. Email: take it only from an official university page or the professor's own homepage. Never guess
   a pattern like first.last@uni.edu. If not found, return null.
3. Recent work: 3–5 papers from the last ~3 years, with a one-line plain summary each. Prefer their
   homepage / Google Scholar / DBLP. Only list papers you actually saw.
4. Recruiting signals (strong → weak): an open "PhD position" / "join us" page with a date in the
   last 12 months; a recent job ad (EURAXESS, university jobs portal, LinkedIn post); a "prospective
   students" page; a new grant; recent new lab members. Quote the evidence and give the URL.
5. Funding: list grants you can confirm (funder, title, years). In Sweden, Norway, Denmark, Finland,
   the Netherlands, Switzerland, Germany, Belgium, Austria, PhD students are usually salaried
   employees, so an advertised position means full funding + insurance.
6. Eligibility: Tamanna has a **BSc only (no master's)**. If the PhD position or the institution's
   PhD admission requires a completed master's (common in FI, SE, NL, DE, CH, DK, NO, BE, AT), say so
   in recruitingEvidence and give fit at most 30: she cannot apply directly. US/CA PhDs (and many
   AU/UK/KR/SG ones) accept a bachelor's.
7. Status checks: skip (fit 0) if they are emeritus, retired, moved to industry, or deceased.

## Learned rules
<!-- The learner appends approved rules below. -->
- **Record contact and requirement fields in the dossier** — Every dossier must include these fields: send_to (the current-institution email, with its source and date), old_addresses, current_university, the position or page URL, required_documents (copied exactly from the page), whether a GRE is needed, and cold_email_policy (welcome / discouraged / unknown). The writer and reviewer check these fields instead of searching again. _(strategist, run 12)_
