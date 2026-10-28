import { requireUser } from "@/lib/session";
import { logout } from "@/lib/auth";
import { Suspense } from "react";
import { Nav } from "@/components/nav";
import { NavProgress } from "@/components/nav-progress";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Suspense>
        <NavProgress />
      </Suspense>
      <aside className="border-b border-line bg-surface md:sticky md:top-0 md:h-screen md:w-56 md:shrink-0 md:border-r md:border-b-0">
        <div className="flex items-center justify-between px-4 py-4 md:block">
          <div className="font-semibold">Sana Agent</div>
          <div className="flex items-center gap-3 text-xs text-muted md:mt-1">
            Signed in as {user.name}
            <form action={logout} className="md:hidden">
              <button className="hover:text-ink">Sign out</button>
            </form>
          </div>
        </div>
        <Nav />
        <form action={logout} className="hidden px-4 py-4 md:block">
          <button className="text-sm text-muted hover:text-ink">Sign out</button>
        </form>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}
