import { setTimeout as sleep } from "node:timers/promises";
import { cfg } from "../config.ts";
import { db, t, and, asc, eq, sql } from "../db.ts";
import { bump, log } from "../log.ts";
import { sendMail } from "../mail.ts";

export const sendGap = () => {
  const [lo, hi] = cfg.sendGapMinutes;
  return (lo + Math.random() * (hi - lo)) * 60000;
};

export async function sentInLast20h() {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(t.emails)
    .where(and(eq(t.emails.status, "sent"), sql`${t.emails.sentAt} > now() - interval '20 hours'`));
  return n;
}

export async function countReadyDrafts() {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(t.emails).where(eq(t.emails.status, "draft"));
  return n;
}

/**
 * Sends the best ready draft. Returns "sent", "skipped" (duplicate blocked),
 * "none" (nothing to send), or "auth" (credentials broken; stop sending).
 * Hard rules: one initial email and at most one follow-up per professor, ever.
 */
export async function sendNext(runId: number): Promise<"sent" | "skipped" | "none" | "auth"> {
  const [next] = await db
    .select({ e: t.emails, p: t.professors })
    .from(t.emails)
    .innerJoin(t.professors, eq(t.professors.id, t.emails.professorId))
    .where(eq(t.emails.status, "draft"))
    .orderBy(sql`${t.emails.kind} = 'follow_up' desc`, sql`${t.professors.priorityScore} desc nulls last`, asc(t.emails.id))
    .limit(1);
  if (!next) return "none";
  const { e, p } = next;

  const prior = await db.select({ kind: t.emails.kind }).from(t.emails).where(and(eq(t.emails.professorId, p.id), eq(t.emails.status, "sent")));
  if (prior.some((x) => x.kind === e.kind) || (e.kind === "follow_up" && !prior.length)) {
    await db.update(t.emails).set({ status: "blocked", reviewNotes: "Duplicate send prevented" }).where(eq(t.emails.id, e.id));
    return "skipped";
  }
  try {
    const messageId = await sendMail({ to: e.toAddress, subject: e.subject, body: e.body, inReplyTo: e.gmailThreadId, attachCv: e.kind === "initial" });
    const now = new Date();
    await db.update(t.emails).set({ status: "sent", sentAt: now, gmailMessageId: messageId, runId }).where(eq(t.emails.id, e.id));
    await db
      .update(t.professors)
      .set(
        e.kind === "initial"
          ? { status: "emailed", lastContactedAt: now, nextFollowUpAt: new Date(now.getTime() + cfg.followUpDays * 86400000) }
          : { status: "followed_up", lastContactedAt: now },
      )
      .where(eq(t.professors.id, p.id));
    bump(e.kind === "initial" ? "emails_sent" : "follow_ups_sent");
    await log("sender", `Sent ${e.kind === "initial" ? "email" : "follow-up"} to ${p.fullName} <${e.toAddress}>`, { professorId: p.id });
    return "sent";
  } catch (err) {
    const msg = (err as Error).message;
    await db.update(t.emails).set({ status: "failed", reviewNotes: `Send failed: ${msg}`.slice(0, 500) }).where(eq(t.emails.id, e.id));
    await log("sender", `Send to ${e.toAddress} failed: ${msg}`, { level: "error", professorId: p.id });
    return /auth|credentials|535|534/i.test(msg) ? "auth" : "skipped";
  }
}

/** Batch mode for `--stages send`: sends ready drafts, spaced out, up to the nightly cap. */
export async function sendDrafts(opts: { dryRun: boolean; runId: number }) {
  if (opts.dryRun) {
    const n = await countReadyDrafts();
    bump("would_send", n);
    if (n) await log("sender", `Dry run: ${n} drafts ready, nothing sent. Read them on the Emails page.`);
    return;
  }
  let first = true;
  while ((await sentInLast20h()) < cfg.nightlyEmailCap) {
    if (!first) await sleep(sendGap());
    first = false;
    const r = await sendNext(opts.runId);
    if (r === "none" || r === "auth") break;
  }
}
