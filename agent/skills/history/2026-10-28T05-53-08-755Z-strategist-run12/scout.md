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
- **Balance US NSF-grant sourcing** — Per run, cap US candidates from NSF grants at roughly half of new candidates, and only keep NSF awards whose end date is on or after Fall 2027. Use the remaining capacity for the allowed European and Asia-Pacific countries, which are now unblocked once rate limiting is handled. _(strategist, run 9)_
- **Prioritise lab pages and job portals** — Spend most search effort on recruiting lab pages and official job boards (university portals, AcademicTransfer, Varbi, Jobbnorge, CISPA careers, IACR jobs, FindAPhD) for the topic queries. Use OpenAlex and NSF only to find extra names, and keep a name only if a recruiting signal or an active grant ending after Fall 2027 is found. _(strategist, run 11)_
