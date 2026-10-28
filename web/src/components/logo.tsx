/** Sana mark: a mortarboard on a blue rounded square (the goal: a funded PhD). */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id="sana-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4c9bf0" />
          <stop offset="1" stopColor="#1c5cab" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#sana-bg)" />
      {/* cap */}
      <path d="M16 7.5 28.5 13 16 18.5 3.5 13Z" fill="#fff" />
      <path d="M9 15.6v4.6c0 1.9 3.1 3.6 7 3.6s7-1.7 7-3.6v-4.6l-7 3.1Z" fill="#fff" opacity=".85" />
      {/* tassel */}
      <path d="M25.6 14.3v6.2" stroke="#ffd166" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="25.6" cy="21.6" r="1.5" fill="#ffd166" />
    </svg>
  );
}

/** Mark + wordmark for the sidebar and login page. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark size={size} />
      <span className="text-[15px] font-semibold tracking-tight">Sana</span>
    </span>
  );
}
