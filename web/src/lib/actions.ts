"use server";

import { and, eq, gte } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, t } from "@/db";
import { requireUser } from "./session";

type ProfStatus = (typeof t.professorStatus.enumValues)[number];
type PosStatus = (typeof t.positionStatus.enumValues)[number];

export async function updateProfessor(id: number, form: FormData) {
  await requireUser();
  const status = String(form.get("status")) as ProfStatus;
  await db
    .update(t.professors)
    .set({
      status: t.professorStatus.enumValues.includes(status) ? status : undefined,
      notes: String(form.get("notes") ?? ""),
      updatedAt: new Date(),
    })
    .where(eq(t.professors.id, id));
  revalidatePath(`/professors/${id}`);
}

export async function setPositionStatus(id: number, form: FormData) {
  await requireUser();
  const status = String(form.get("status")) as PosStatus;
  if (!t.positionStatus.enumValues.includes(status)) return;
  await db
    .update(t.positions)
    .set({ status, appliedAt: status === "applied" ? new Date() : undefined })
    .where(eq(t.positions.id, id));
  revalidatePath("/positions");
}

export async function toggleReplyHandled(id: number, handled: boolean) {
  await requireUser();
  await db.update(t.replies).set({ handled }).where(eq(t.replies.id, id));
  revalidatePath("/replies");
}

export async function decideLearning(id: number, approve: boolean) {
  await requireUser();
  await db
    .update(t.learnings)
    .set({ status: approve ? "approved" : "rejected", decidedAt: new Date() })
    .where(eq(t.learnings.id, id));
  revalidatePath("/learnings");
}

export async function addLink(form: FormData) {
  await requireUser();
  const title = String(form.get("title") ?? "").trim();
  const url = String(form.get("url") ?? "").trim();
  if (!title || !/^https?:\/\//.test(url)) return;
  await db.insert(t.links).values({
    title,
    url,
    category: String(form.get("category") ?? "general").trim() || "general",
    notes: String(form.get("notes") ?? "").trim() || null,
  });
  revalidatePath("/links");
}

export async function deleteLink(id: number) {
  await requireUser();
  await db.delete(t.links).where(eq(t.links.id, id));
  revalidatePath("/links");
}

/**
 * Puts the agent's playbooks/strategy back to the snapshot taken before this
 * change. Files are restored as a whole, so later changes are undone too.
 */
export async function revertLearning(id: number) {
  await requireUser();
  const [l] = await db.select().from(t.learnings).where(eq(t.learnings.id, id));
  if (!l?.snapshot) return;
  const { cpSync, existsSync, readdirSync } = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(process.cwd(), "..");
  const dir = path.join(root, l.snapshot);
  if (!dir.startsWith(path.join(root, "agent/skills/history")) || !existsSync(dir)) return;
  for (const f of readdirSync(dir)) {
    const dest = f === "strategy.json" ? path.join(root, "agent/strategy.json") : path.join(root, "agent/skills", f);
    cpSync(path.join(dir, f), dest);
  }
  await db
    .update(t.learnings)
    .set({ status: "reverted", decidedAt: new Date() })
    .where(and(gte(t.learnings.id, id), eq(t.learnings.status, "applied")));
  revalidatePath("/learnings");
}
