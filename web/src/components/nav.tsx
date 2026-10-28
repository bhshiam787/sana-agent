"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Overview" },
  { href: "/professors", label: "Professors" },
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
            className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm ${
              active ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:bg-surface-2"
            }`}
          >
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
