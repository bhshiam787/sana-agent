import {
  pgTable,
  pgEnum,
  serial,
  text,
  integer,
  real,
  boolean,
  timestamp,
  date,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Shared by the dashboard and the overnight agent. Keep enums in sync with agent/.

/** Deep research on a shortlisted professor's public professional record. */
export type Dossier = {
  careerTimeline: { year: string; event: string }[];
  researchTrajectory: string;
  currentDirection: string;
  valuesInStudents: string;
  communicationStyle: string;
  labCulture: string;
  recentNews: string[];
  hooks: { point: string; source: string }[];
  redFlags: string[];
  sources: string[];
  researchedAt: string;
};

export const professorStatus = pgEnum("professor_status", [
  "discovered", // found, not yet researched
  "researched", // profile, papers, grants collected
  "shortlisted", // scored high enough to contact
  "emailed",
  "followed_up",
  "replied",
  "positive", // interested / asked for CV / call
  "interview",
  "offer",
  "rejected",
  "skipped", // low fit or bad data
]);

export const positionStatus = pgEnum("position_status", [
  "found",
  "emailed",
  "applied", // formal application submitted
  "needs_manual", // portal / fee / recommendation letters needed
  "closed",
  "rejected",
  "offer",
]);

export const emailStatus = pgEnum("email_status", ["draft", "sent", "failed", "blocked"]);

export const replyClass = pgEnum("reply_class", [
  "positive",
  "ask_cv",
  "apply_formally",
  "no_funding",
  "negative",
  "auto_reply",
  "other",
]);

export const runStatus = pgEnum("run_status", ["running", "completed", "failed", "stopped"]);

export const learningStatus = pgEnum("learning_status", ["proposed", "approved", "rejected", "applied"]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const universities = pgTable(
  "universities",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    country: text("country").notNull(),
    city: text("city"),
    rank: integer("rank"),
    website: text("website"),
    fundingNotes: text("funding_notes"), // e.g. "PhD = salaried employee, ~€3,000/mo"
  },
  (t) => [uniqueIndex("universities_name_country").on(t.name, t.country)],
);

export const professors = pgTable(
  "professors",
  {
    id: serial("id").primaryKey(),
    fullName: text("full_name").notNull(),
    title: text("title"), // Assistant / Associate / Full Professor
    universityId: integer("university_id").references(() => universities.id),
    department: text("department"),
    country: text("country"),
    email: text("email"),
    homepage: text("homepage"),
    labUrl: text("lab_url"),
    scholarUrl: text("scholar_url"),
    linkedinUrl: text("linkedin_url"),
    openalexId: text("openalex_id").unique(),
    researchAreas: text("research_areas").array(),
    summary: text("summary"), // what they work on now, in plain words
    whyMatch: text("why_match"), // why they fit the applicant
    hIndex: integer("h_index"),
    recentPapers: integer("recent_papers"), // last 2 years
    recruiting: boolean("recruiting").default(false).notNull(),
    recruitingEvidence: text("recruiting_evidence"),
    fitScore: real("fit_score"), // 0-100
    fundingScore: real("funding_score"), // 0-100
    replyScore: real("reply_score"), // 0-100
    priorityScore: real("priority_score"), // weighted combination
    dossier: jsonb("dossier").$type<Dossier>(), // deep professional research, see Dossier
    contactInstructions: text("contact_instructions"), // what they ask prospective students to do
    status: professorStatus("status").default("discovered").notNull(),
    source: text("source"), // openalex, linkedin, euraxess, google ...
    sourceUrl: text("source_url"),
    notes: text("notes"),
    lastContactedAt: timestamp("last_contacted_at", { withTimezone: true }),
    nextFollowUpAt: timestamp("next_follow_up_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("professors_status").on(t.status),
    index("professors_country").on(t.country),
    index("professors_priority").on(t.priorityScore),
    uniqueIndex("professors_email").on(t.email),
  ],
);

export const papers = pgTable("papers", {
  id: serial("id").primaryKey(),
  professorId: integer("professor_id")
    .references(() => professors.id, { onDelete: "cascade" })
    .notNull(),
  title: text("title").notNull(),
  year: integer("year"),
  venue: text("venue"),
  url: text("url"),
  summary: text("summary"),
  relevance: real("relevance"), // 0-1 vs applicant profile
});

export const grants = pgTable("grants", {
  id: serial("id").primaryKey(),
  professorId: integer("professor_id")
    .references(() => professors.id, { onDelete: "cascade" })
    .notNull(),
  funder: text("funder").notNull(), // NSF, NIH, ERC, DFG, UKRI ...
  title: text("title"),
  amount: real("amount"),
  currency: text("currency"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  url: text("url"),
});

export const positions = pgTable(
  "positions",
  {
    id: serial("id").primaryKey(),
    professorId: integer("professor_id").references(() => professors.id, { onDelete: "set null" }),
    universityId: integer("university_id").references(() => universities.id),
    title: text("title").notNull(),
    kind: text("kind").notNull(), // phd, masters, scholarship, ra
    country: text("country"),
    funding: text("funding"), // stipend / salary / insurance details
    deadline: date("deadline"),
    url: text("url").notNull(),
    source: text("source"), // linkedin, euraxess, findaphd ...
    status: positionStatus("status").default("found").notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("positions_url").on(t.url), index("positions_deadline").on(t.deadline)],
);

export const agentRuns = pgTable("agent_runs", {
  id: serial("id").primaryKey(),
  startedBy: integer("started_by").references(() => users.id),
  machine: text("machine"),
  dryRun: boolean("dry_run").default(false).notNull(),
  status: runStatus("status").default("running").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  stats: jsonb("stats").$type<Record<string, number>>(),
  summary: text("summary"),
  error: text("error"),
});

export const emails = pgTable(
  "emails",
  {
    id: serial("id").primaryKey(),
    professorId: integer("professor_id")
      .references(() => professors.id, { onDelete: "cascade" })
      .notNull(),
    positionId: integer("position_id").references(() => positions.id, { onDelete: "set null" }),
    runId: integer("run_id").references(() => agentRuns.id),
    kind: text("kind").default("initial").notNull(), // initial, follow_up
    toAddress: text("to_address").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    attachments: text("attachments").array(),
    status: emailStatus("status").default("draft").notNull(),
    reviewScore: real("review_score"), // quality-gate score 0-100
    reviewNotes: text("review_notes"),
    gmailMessageId: text("gmail_message_id"),
    gmailThreadId: text("gmail_thread_id"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("emails_sent_at").on(t.sentAt), index("emails_professor").on(t.professorId)],
);

export const replies = pgTable("replies", {
  id: serial("id").primaryKey(),
  emailId: integer("email_id").references(() => emails.id, { onDelete: "set null" }),
  professorId: integer("professor_id")
    .references(() => professors.id, { onDelete: "cascade" })
    .notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
  fromAddress: text("from_address"),
  snippet: text("snippet"),
  body: text("body"),
  classification: replyClass("classification").default("other").notNull(),
  suggestedAction: text("suggested_action"),
  gmailMessageId: text("gmail_message_id").unique(),
  handled: boolean("handled").default(false).notNull(),
});

export const activity = pgTable(
  "activity",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id").references(() => agentRuns.id, { onDelete: "cascade" }),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
    agent: text("agent").notNull(), // scout, profiler, scorer, writer, reviewer, sender, inbox, learner
    level: text("level").default("info").notNull(), // info, warn, error
    message: text("message").notNull(),
    professorId: integer("professor_id").references(() => professors.id, { onDelete: "set null" }),
  },
  (t) => [index("activity_at").on(t.at)],
);

export const learnings = pgTable("learnings", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").references(() => agentRuns.id, { onDelete: "set null" }),
  agent: text("agent").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(), // the proposed skill change
  status: learningStatus("status").default("proposed").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

export const links = pgTable("links", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  category: text("category").default("general").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
