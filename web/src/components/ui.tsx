import Link from "next/link";
import { chipClass, label } from "@/lib/format";

export function Chip({ status }: { status: string }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs text-ink ${chipClass(status)}`}>
      {label(status)}
    </span>
  );
}

export function PageHeader({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      {children}
    </div>
  );
}

export function Stat({ label, value, hint, href }: { label: string; value: number | string; hint?: string; href?: string }) {
  const body = (
    <div
      className={`card relative h-full p-4 transition duration-150 ${
        href ? "group-hover:border-hover-line group-hover:shadow-[0_0_0_1px_var(--hover-line),0_10px_28px_-14px_var(--accent)]" : ""
      }`}
    >
      {href && (
        <span aria-hidden className="absolute top-3 right-3 text-sm text-accent opacity-0 transition-opacity group-hover:opacity-100">
          →
        </span>
      )}
      <div className={`text-xs text-muted ${href ? "transition-colors group-hover:text-accent" : ""}`}>{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-2">{hint}</div>}
    </div>
  );
  // A class keeps the site-wide plain-link hover (blue + underline) off the whole card.
  return href ? (
    <Link href={href} className="group block h-full rounded-xl no-underline">
      {body}
    </Link>
  ) : (
    body
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-10 text-center text-sm text-muted">{children}</div>;
}

export function ExtLink({ href, children }: { href: string | null | undefined; children: React.ReactNode }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-accent hover:underline">
      {children}
    </a>
  );
}

// Builds a URL that keeps the current filters and overrides some.
export function withParams(base: string, current: Record<string, string | undefined>, next: Record<string, string | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...current, ...next })) if (v) p.set(k, v);
  const qs = p.toString();
  return qs ? `${base}?${qs}` : base;
}
