# Scout playbook

Goal: find funded PhD / funded masters positions and professors who are likely recruiting.

## Where to look (best first)
1. EURAXESS job search, university job portals (Sweden: Varbi; Netherlands: academictransfer.com;
   Denmark/Norway: jobbnorge.no), FindAPhD, AcademicPositions, jobs.ac.uk.
2. LinkedIn posts by professors ("PhD position", "hiring PhD", "open PhD", "funded PhD").
3. Lab websites with "open positions" pages.

## Keep only
- Positions that state funding (salary, stipend, scholarship, tuition waiver) or are in a country
  where PhD positions are salaried by default.
- Deadlines in the future (or "open until filled").
- Topics close to Tamanna's research areas.

## Learned rules
<!-- The learner appends approved rules below. -->
- **Respect OpenAlex rate limits** — Make OpenAlex calls one at a time. Use the polite pool (mailto parameter) and pause at least 1 second between requests. On HTTP 429, honour Retry-After or back off exponentially (2s, 4s, 8s…, max 3 retries) and then postpone that country to the next run instead of failing. Cache university lists per country and reuse them across runs rather than re-querying all countries in one burst. _(strategist, run 9)_
- **Drop candidates outside target countries** — Before saving a candidate, check their current institution's country. Keep only allowed-list countries plus explicitly named fully funded exceptions (e.g. KAUST in SA, MBZUAI in AE). Discard others (e.g. CN, IN, BD, EG, ZA, GR, CZ, SK, BG, LT, MA, QA) unless the page shows a fully funded PhD position open to international applicants. _(strategist, run 9)_
- **Prioritise lab pages and job portals** — Spend most search effort on recruiting lab pages and official job boards (university portals, AcademicTransfer, Varbi, Jobbnorge, CISPA careers, IACR jobs, FindAPhD) for the topic queries. Use OpenAlex and NSF only to find extra names, and keep a name only if a recruiting signal or an active grant ending after Fall 2027 is found. _(strategist, run 11)_
- **Cap OpenAlex use per run** — Run at most 3 OpenAlex topic queries per run, one at a time. Before sending a query, strip job words ('PhD position', 'vacancy', 'Europe'); OpenAlex indexes papers, not jobs. If a 429 is still returned after the backoff, stop all OpenAlex calls (works and institutions) for the rest of the run, log it once, and switch to lab pages and job portals. _(strategist, run 12)_
- **Fit each search inside the turn budget** — Give each search session one country or one query. Save each candidate as soon as it is verified, rather than at the end. Stop after 8 candidates or once about two-thirds of the turn budget is used, whichever comes first, and leave the rest for the next run. _(strategist, run 12)_
- **Keep NSF names only with a recruiting signal** — From NSF awards, save a PI only if the award ends on or after Aug 2027, its abstract matches topic priorities 1–3 (ML for security, privacy-preserving/federated learning, adversarial robustness/LLM security), AND the PI's homepage or lab page shows a recruiting signal. Save at most 10 NSF-sourced names per run. _(strategist, run 13)_
- **Pause OpenAlex while it yields nothing** — Skip OpenAlex topic searches entirely for the next 3 runs, because it has 115 found, 0 shortlisted and repeated 429s. Spend that budget on recruiting lab pages and job portals for KR, JP, CH, AT, DK and FR. After the pause, follow the 'Cap OpenAlex use per run' rule. _(strategist, run 13)_
