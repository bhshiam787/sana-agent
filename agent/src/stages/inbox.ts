import { z } from "zod";
import { db, t, eq, isNotNull } from "../db.ts";
import { ask, UsageLimitError } from "../llm.ts";
import { bump, log } from "../log.ts";
import { fetchInbox } from "../mail.ts";

const Classified = z.object({
  classification: z.enum(["positive", "ask_cv", "apply_formally", "no_funding", "negative", "auto_reply", "other"]),
  suggestedAction: z.string().describe("One concrete next step for Tamanna, with any deadline mentioned"),
  snippet: z.string().describe("The key sentence(s) of the reply, max 200 chars"),
});

const nextStatus = {
  positive: "positive",
  ask_cv: "positive",
  apply_formally: "positive",
  no_funding: "rejected",
  negative: "rejected",
  other: "replied",
} as const;

/** Matches inbox mail to professors we emailed and classifies each new reply. */
export async function readReplies() {
  const sent = await db.select({ e: t.emails, p: t.professors }).from(t.emails).innerJoin(t.professors, eq(t.professors.id, t.emails.professorId)).where(isNotNull(t.emails.gmailMessageId));
  if (!sent.length) return;
  const byMsgId = new Map(sent.map((r) => [r.e.gmailMessageId!, r]));
  const byAddress = new Map(sent.map((r) => [r.e.toAddress.toLowerCase(), r]));
  const known = new Set((await db.select({ id: t.replies.gmailMessageId }).from(t.replies)).map((r) => r.id));

  const inbox = await fetchInbox(45);
  let found = 0;
  for (const m of inbox) {
    if (known.has(m.messageId)) continue;
    const match = m.inReplyTo.map((id) => byMsgId.get(id)).find(Boolean) ?? byAddress.get(m.from);
    if (!match) continue;
    try {
      const c = await ask({
        tier: "bulk",
        system: "You classify replies from professors to a prospective graduate student's outreach email.",
        prompt: `Our email to ${match.p.fullName}:\nSubject: ${match.e.subject}\n\nTheir reply (from ${m.from}, ${m.date.toISOString()}):\nSubject: ${m.subject}\n${m.text}`,
        schema: Classified,
        maxTurns: 4,
        effort: "low",
      });
      await db.insert(t.replies).values({
        emailId: match.e.id,
        professorId: match.p.id,
        receivedAt: m.date,
        fromAddress: m.from,
        snippet: c.snippet,
        body: m.text,
        classification: c.classification,
        suggestedAction: c.suggestedAction,
        gmailMessageId: m.messageId,
      }).onConflictDoNothing();
      if (c.classification !== "auto_reply")
        await db.update(t.professors).set({ status: nextStatus[c.classification], nextFollowUpAt: null, updatedAt: new Date() }).where(eq(t.professors.id, match.p.id));
      found++;
      bump(c.classification === "auto_reply" ? "auto_replies" : "replies_received");
      await log("inbox", `Reply from ${match.p.fullName}: ${c.classification} — ${c.suggestedAction}`, { professorId: match.p.id });
    } catch (e) {
      if (e instanceof UsageLimitError) throw e;
      await log("inbox", `Could not classify reply from ${m.from}: ${(e as Error).message}`, { level: "warn" });
    }
  }
  await log("inbox", `Checked ${inbox.length} inbox messages, ${found} new replies`);
}
