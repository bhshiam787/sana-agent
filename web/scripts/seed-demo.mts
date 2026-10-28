// Fills an embedded test database with fake data to preview the dashboard.
// Refuses to run against Neon so real data is never polluted.
// Usage: DATABASE_URL=pglite:./.pglite pnpm seed:demo
import "dotenv/config";
import { db, t } from "../src/db";

if (!process.env.DATABASE_URL?.startsWith("pglite:")) {
  console.error("seed:demo only runs against a pglite: database.");
  process.exit(1);
}

const day = 86400000;
const ago = (d: number) => new Date(Date.now() - d * day);

const [run] = await db
  .insert(t.agentRuns)
  .values({
    machine: "Demo MacBook",
    status: "completed",
    startedAt: ago(0.4),
    endedAt: ago(0.1),
    stats: { professors_found: 42, researched: 30, emails_sent: 18, blocked_by_reviewer: 3, replies_read: 4 },
    summary: "Demo run. Found 42 professors, researched 30, sent 18 emails. 3 drafts were blocked by the reviewer.",
  })
  .returning();

const unis = await db
  .insert(t.universities)
  .values([
    { name: "KTH Royal Institute of Technology", country: "Sweden", fundingNotes: "PhD is a salaried job" },
    { name: "TU Delft", country: "Netherlands" },
    { name: "University of Waterloo", country: "Canada" },
    { name: "TU Munich", country: "Germany" },
  ])
  .returning();

const statuses = ["discovered", "researched", "shortlisted", "emailed", "emailed", "replied", "positive", "followed_up"] as const;
const profs = await db
  .insert(t.professors)
  .values(
    Array.from({ length: 24 }, (_, i) => ({
      fullName: `Demo Professor ${i + 1}`,
      title: ["Assistant Professor", "Associate Professor", "Professor"][i % 3],
      universityId: unis[i % unis.length].id,
      country: unis[i % unis.length].country,
      email: `prof${i + 1}@example.edu`,
      researchAreas: [["federated learning", "privacy"], ["phishing detection", "security ML"], ["HCI", "online experiments"]][i % 3],
      summary: "Demo summary of current research.",
      recruiting: i % 4 === 0,
      fitScore: 40 + ((i * 7) % 55),
      fundingScore: 30 + ((i * 11) % 65),
      replyScore: 20 + ((i * 5) % 70),
      priorityScore: 35 + ((i * 9) % 60),
      status: statuses[i % statuses.length],
      source: ["openalex", "linkedin", "euraxess"][i % 3],
      lastContactedAt: i % 8 >= 3 ? ago(i % 20) : null,
      nextFollowUpAt: i % 8 === 3 ? ago(-1) : null,
    })),
  )
  .returning();

const sent = profs.filter((p) => p.lastContactedAt);
const emails = await db
  .insert(t.emails)
  .values(
    sent.map((p) => ({
      professorId: p.id,
      runId: run.id,
      toAddress: p.email!,
      subject: "Prospective PhD student: federated learning for phishing detection",
      body: "Dear Professor,\n\nDemo email body.\n\nBest regards,\nTamanna",
      status: "sent" as const,
      reviewScore: 82,
      sentAt: p.lastContactedAt,
    })),
  )
  .returning();

const repliedProfs = profs.filter((p) => p.status === "replied" || p.status === "positive");
await db.insert(t.replies).values(
  repliedProfs.map((p, i) => ({
    professorId: p.id,
    emailId: emails.find((e) => e.professorId === p.id)?.id,
    receivedAt: ago(i),
    snippet: i % 2 ? "Thank you for your interest. Please send your CV and transcripts." : "Unfortunately I have no funding this year.",
    body: "Demo reply body.",
    classification: i % 2 ? ("ask_cv" as const) : ("no_funding" as const),
    suggestedAction: i % 2 ? "Send CV + transcripts within 48h." : "Ask whether a colleague is recruiting.",
  })),
);

await db.insert(t.positions).values([
  { title: "Doctoral student in trustworthy ML", kind: "phd", country: "Sweden", universityId: unis[0].id, funding: "Salaried, ~SEK 35,000/mo, health insurance", deadline: new Date(Date.now() + 10 * day).toISOString().slice(0, 10), url: "https://example.org/pos1", source: "euraxess" },
  { title: "PhD position: privacy-preserving learning", kind: "phd", country: "Netherlands", universityId: unis[1].id, funding: "Full salary + benefits", deadline: new Date(Date.now() + 40 * day).toISOString().slice(0, 10), url: "https://example.org/pos2", source: "linkedin", status: "needs_manual" },
]);

await db.insert(t.activity).values([
  { runId: run.id, agent: "scout", message: "Searched OpenAlex for 'federated learning' authors, 120 candidates" },
  { runId: run.id, agent: "scout", level: "warn", message: "LinkedIn search slowed down; switching to EURAXESS" },
  { runId: run.id, agent: "reviewer", message: "Blocked draft: cited paper not found on professor's page", professorId: profs[2].id },
  { runId: run.id, agent: "sender", message: "Sent 18 emails between 23:10 and 05:40" },
]);

await db.insert(t.learnings).values({
  runId: run.id,
  agent: "scout",
  title: "University X hides emails behind a JS directory",
  content: "Use the /api/people endpoint instead of scraping the HTML staff page.",
});

console.log("Demo data seeded.");
process.exit(0);
