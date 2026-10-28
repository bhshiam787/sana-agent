import { setTimeout as sleep } from "node:timers/promises";
import { cfg } from "../config.ts";
import { db, t, and, asc, eq, inArray, sql } from "../db.ts";
import { bump, log } from "../log.ts";
import { sendMail } from "../mail.ts";

const gap = () => {
  const [lo, hi] = cfg.sendGapMinutes;
  return (lo + Math.random() * (hi - lo)) * 60000;
};

/**
 * Sends ready drafts, spaced out. Dry run leaves them as drafts.
 * Hard rules: one initial email per professor ever, one follow-up ever, nightly cap.
 */
export async function sendDrafts(opts: { dryRun: boolean; runId: number }) {
  const drafts = await db
    .select({ e: t.emails, p: t.professors })
    .from(t.emails)
    .innerJoin(t.professors, eq(t.professors.id, t.emails.professorId))
    .where(eq(t.emails.status, "draft"))
    .orderBy(sql`${t.emails.kind} = 'follow_up' desc`, sql`${t.professors.priorityScore} desc nulls last`, asc(t.emails.id));

  if (opts.dryRun) {
    if (drafts.length) await log("sender", `Dry run: ${drafts.length} drafts ready, nothing sent. Read them on the Emails page.`);
    bump("would_send", drafts.length);
    return;
  }

  const [{ sentToday }] = await db
    .select({ sentToday: sql<number>`count(*)::int` })
    .from(t.emails)
    .where(and(eq(t.emails.status, "sent"), sql`${t.emails.sentAt} > now() - interval '20 hours'`));
  let budget = cfg.nightlyEmailCap - sentToday;

  for (const [i, { e, p }] of drafts.entries()) {
    if (budget <= 0) {
      await log("sender", `Nightly cap of ${cfg.nightlyEmailCap} reached; ${drafts.length - i} drafts wait for the next run.`);
      break;
    }
    const prior = await db
      .select({ kind: t.emails.kind })
      .from(t.emails)
      .where(and(eq(t.emails.professorId, p.id), inArray(t.emails.status, ["sent"])));
    if (prior.some((x) => x.kind === e.kind) || (e.kind === "follow_up" && !prior.length)) {
      await db.update(t.emails).set({ status: "blocked", reviewNotes: "Duplicate send prevented" }).where(eq(t.emails.id, e.id));
      continue;
    }
    if (i > 0) await sleep(gap());
    try {
      const messageId = await sendMail({ to: e.toAddress, subject: e.subject, body: e.body, inReplyTo: e.gmailThreadId, attachCv: e.kind === "initial" });
      const now = new Date();
      await db.update(t.emails).set({ status: "sent", sentAt: now, gmailMessageId: messageId, runId: opts.runId }).where(eq(t.emails.id, e.id));
      await db
        .update(t.professors)
        .set(
          e.kind === "initial"
            ? { status: "emailed", lastContactedAt: now, nextFollowUpAt: new Date(now.getTime() + cfg.followUpDays * 86400000) }
            : { status: "followed_up", lastContactedAt: now },
        )
        .where(eq(t.professors.id, p.id));
      budget--;
      bump(e.kind === "initial" ? "emails_sent" : "follow_ups_sent");
      await log("sender", `Sent ${e.kind === "initial" ? "email" : "follow-up"} to ${p.fullName} <${e.toAddress}>`, { professorId: p.id });
    } catch (err) {
      await db.update(t.emails).set({ status: "failed", reviewNotes: `Send failed: ${(err as Error).message}`.slice(0, 500) }).where(eq(t.emails.id, e.id));
      await log("sender", `Send to ${e.toAddress} failed: ${(err as Error).message}`, { level: "error", professorId: p.id });
      if (/auth|credentials|535|534/i.test((err as Error).message)) break;
    }
  }
}
