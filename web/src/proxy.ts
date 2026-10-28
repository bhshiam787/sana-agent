import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const key = new TextEncoder().encode(process.env.SESSION_SECRET);

// Optimistic check only; pages also call requireUser().
export async function proxy(request: NextRequest) {
  const token = request.cookies.get("session")?.value;
  let ok = false;
  if (token) {
    try {
      await jwtVerify(token, key, { algorithms: ["HS256"] });
      ok = true;
    } catch {}
  }
  const isLogin = request.nextUrl.pathname === "/login";
  if (!ok && !isLogin) return NextResponse.redirect(new URL("/login", request.url));
  if (ok && isLogin) return NextResponse.redirect(new URL("/", request.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
