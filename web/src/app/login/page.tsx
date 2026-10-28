"use client";

import { useActionState } from "react";
import { login } from "@/lib/auth";
import { Logo } from "@/components/logo";
import { LoadingOverlay } from "@/components/loading-overlay";
import { Spinner } from "@/components/submit-button";

export default function LoginPage() {
  const [error, action, pending] = useActionState(login, undefined);
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form action={action} className="card w-full max-w-sm space-y-4 p-6">
        <div>
          <div className="mb-3"><Logo size={36} /></div>
          <h1 className="text-lg font-semibold">Sign in</h1>
          <p className="text-sm text-muted">Sign in to see the outreach dashboard.</p>
        </div>
        <label className="block space-y-1">
          <span className="text-sm text-ink-2">Email</span>
          <input name="email" type="email" required autoComplete="email" className="input w-full" />
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-ink-2">Password</span>
          <input name="password" type="password" required autoComplete="current-password" className="input w-full" />
        </label>
        {error && <p className="text-sm text-critical">{error}</p>}
        <button className="btn w-full" disabled={pending}>
          {pending && <Spinner />}
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
      {pending && <LoadingOverlay label="Signing in…" />}
    </main>
  );
}
