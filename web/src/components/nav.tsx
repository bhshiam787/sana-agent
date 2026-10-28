"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Overview" },
  { href: "/professors", label: "Professors" },
  { href: "/research", label: "Research results" },
  { href: "/positions", label: "Positions & deadlines" },
  { href: "/emails", label: "Emails sent" },
  { href: "/replies", label: "Replies" },
  { href: "/runs", label: "Agent runs" },
  { href: "/learnings", label: "Learnings" },
  { href: "/links", label: "Useful links" },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-visible md:pb-0">
      {items.map((i) => {
        const active = i.href === "/" ? path === "/" : path.startsWith(i.href);
        return (
          <Link
            key={i.href}
            href={i.href}
            className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors ${
              active
                ? "bg-accent/20 font-medium text-ink shadow-[inset_3px_0_0_var(--accent)]"
                : "text-ink-2 hover:bg-hover hover:text-ink hover:shadow-[inset_3px_0_0_var(--hover-line)]"
            }`}
          >
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
