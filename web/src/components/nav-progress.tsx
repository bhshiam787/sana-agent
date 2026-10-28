"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { LoadingOverlay } from "./loading-overlay";

/**
 * Thin bar at the top from the moment an internal link is clicked or a filter
 * form is submitted until the new page has rendered.
 */
export function NavProgress() {
  const path = usePathname();
  const params = useSearchParams();
  const here = `${path}?${params.toString()}`;
  // The URL a navigation started from; once the rendered URL differs, it has finished.
  const [from, setFrom] = useState<string | null>(null);
  const busy = from === here;
  const start = () => setFrom(`${location.pathname}?${new URLSearchParams(location.search).toString()}`);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      // Not checking defaultPrevented: next/link cancels the native navigation itself.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement).closest("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname.startsWith("/professors/export")) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      start();
    };
    // GET filter forms navigate too; server-action forms finish via a re-render.
    const onSubmit = (e: SubmitEvent) => {
      const f = e.target as HTMLFormElement;
      if ((f.method || "get").toLowerCase() === "get" && !f.getAttribute("action")?.startsWith("javascript")) start();
    };
    document.addEventListener("click", onClick);
    document.addEventListener("submit", onSubmit);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("submit", onSubmit);
    };
  }, []);

  // Safety net: never spin forever.
  useEffect(() => {
    if (!busy) return;
    const id = setTimeout(() => setFrom(null), 20_000);
    return () => clearTimeout(id);
  }, [busy]);

  return busy ? <LoadingOverlay /> : null;
}
