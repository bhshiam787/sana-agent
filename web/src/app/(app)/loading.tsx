/** Shown instantly while any dashboard page loads its data. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="mb-2 h-6 w-48 rounded bg-surface-2" />
      <div className="mb-6 h-4 w-80 rounded bg-surface-2" />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="card h-24" />
        ))}
      </div>
      <div className="card space-y-3 p-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-4 rounded bg-surface-2" style={{ width: `${90 - (i % 4) * 12}%` }} />
        ))}
      </div>
      <p className="mt-4 flex items-center gap-2 text-sm text-muted">
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        Loading…
      </p>
    </div>
  );
}
