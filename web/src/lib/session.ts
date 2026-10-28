import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const COOKIE = "session";
const key = new TextEncoder().encode(process.env.SESSION_SECRET);

export type Session = { userId: number; name: string };

export async function encrypt(payload: Session) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(key);
}

export async function decrypt(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    return { userId: Number(payload.userId), name: String(payload.name) };
  } catch {
    return null;
  }
}

export async function createSession(session: Session) {
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  (await cookies()).set(COOKIE, await encrypt(session), {
    httpOnly: true,
    // Served over plain http on localhost / home network only.
    secure: false,
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export async function getSession() {
  return decrypt((await cookies()).get(COOKIE)?.value);
}

export async function deleteSession() {
  (await cookies()).delete(COOKIE);
}

export async function requireUser() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}
