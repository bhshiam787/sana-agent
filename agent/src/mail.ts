import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { existsSync } from "node:fs";
import { cfg } from "./config.ts";

export const mailConfigured = () => Boolean(cfg.gmailUser && cfg.gmailAppPassword);

const transport = () =>
  nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: cfg.gmailUser, pass: cfg.gmailAppPassword } });

export async function sendMail(o: { to: string; subject: string; body: string; inReplyTo?: string | null; attachCv: boolean }) {
  if (o.attachCv && !existsSync(cfg.cvPath)) throw new Error(`CV not found at ${cfg.cvPath}`);
  const info = await transport().sendMail({
    from: { name: cfg.senderName, address: cfg.gmailUser },
    to: o.to,
    subject: o.subject,
    text: o.body,
    ...(o.inReplyTo ? { inReplyTo: o.inReplyTo, references: [o.inReplyTo] } : {}),
    attachments: o.attachCv ? [{ filename: "Tamanna_Zubairi_Sana_CV.pdf", path: cfg.cvPath }] : [],
  });
  return info.messageId as string;
}

export async function verifyMail() {
  await transport().verify();
}

export type Incoming = { messageId: string; from: string; subject: string; date: Date; text: string; inReplyTo: string[] };

/** Inbox messages from the last `days` days, newest last. */
export async function fetchInbox(days: number): Promise<Incoming[]> {
  const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user: cfg.gmailUser, pass: cfg.gmailAppPassword }, logger: false });
  await client.connect();
  const out: Incoming[] = [];
  const lock = await client.getMailboxLock("INBOX");
  try {
    const since = new Date(Date.now() - days * 86400000);
    for await (const msg of client.fetch({ since }, { source: true, envelope: true })) {
      if (!msg.source) continue;
      const m = await simpleParser(msg.source);
      const refs = [m.inReplyTo, ...(Array.isArray(m.references) ? m.references : m.references ? [m.references] : [])].filter(Boolean) as string[];
      out.push({
        messageId: m.messageId ?? `${msg.uid}@imap`,
        from: m.from?.value[0]?.address?.toLowerCase() ?? "",
        subject: m.subject ?? "",
        date: m.date ?? new Date(),
        text: (m.text ?? "").slice(0, 8000),
        inReplyTo: refs,
      });
    }
  } finally {
    lock.release();
    await client.logout();
  }
  return out;
}
