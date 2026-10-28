/** Full-screen "please wait" layer: dims the page, centre card with spinner and progress bar. */
export function LoadingOverlay({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="loading-overlay" role="progressbar" aria-busy="true" aria-label={label}>
      <div className="card flex w-64 flex-col items-center gap-3 px-6 py-5 shadow-2xl">
        <span aria-hidden className="inline-block h-7 w-7 animate-spin rounded-full border-[3px] border-accent border-t-transparent" />
        <span className="text-sm font-medium">{label}</span>
        <span className="loading-overlay-bar" aria-hidden />
      </div>
    </div>
  );
}
