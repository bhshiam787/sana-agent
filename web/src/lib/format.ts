export function fmtDate(d: Date | string | null | undefined, withTime = false) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

export function timeAgo(d: Date | string | null | undefined) {
  if (!d) return "—";
  const ms = Date.now() - new Date(d).getTime();
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function score(n: number | null | undefined) {
  return n == null ? "—" : Math.round(n).toString();
}

export const label = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

// Status chips always pair color with the text label, never color alone.
const tone: Record<string, string> = {
  positive: "good",
  interview: "good",
  offer: "good",
  ask_cv: "good",
  applied: "good",
  sent: "good",
  completed: "good",
  approved: "good",
  replied: "accent",
  emailed: "accent",
  followed_up: "accent",
  apply_formally: "accent",
  running: "accent",
  paused: "warning",
  shortlisted: "accent",
  needs_manual: "warning",
  proposed: "warning",
  draft: "warning",
  no_funding: "serious",
  rejected: "critical",
  negative: "critical",
  failed: "critical",
  blocked: "critical",
};

export function chipClass(status: string) {
  switch (tone[status]) {
    case "good":
      return "border-good/40 bg-good/10";
    case "accent":
      return "border-accent/40 bg-accent/10";
    case "warning":
      return "border-warning/50 bg-warning/10";
    case "serious":
      return "border-serious/50 bg-serious/10";
    case "critical":
      return "border-critical/40 bg-critical/10";
    default:
      return "border-line bg-surface-2";
  }
}

// Server components render per request, so "now" is the request time.
export function daysFromNow(days: number) {
  return new Date(Date.now() + days * 86400000);
}
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export const minutesSince = (d: Date | string) => (Date.now() - new Date(d).getTime()) / 60000;
