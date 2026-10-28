"use server";

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, t } from "@/db";
import { createSession, deleteSession } from "./session";

export async function login(_prev: string | undefined, form: FormData) {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const [user] = await db.select().from(t.users).where(eq(t.users.email, email)).limit(1);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return "Wrong email or password.";
  }
  await createSession({ userId: user.id, name: user.name });
  redirect("/");
}

export async function logout() {
  await deleteSession();
  redirect("/login");
}
