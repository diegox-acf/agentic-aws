// /stats/?code=… : the code is a query string because a static export cannot prerender
// /stats/[code] for codes that don't exist yet. The client component that reads it with
// useSearchParams must sit inside <Suspense>, or `next build` fails.
// TODO(Diego, M2): StatsView. See the hints in the M2 PR.
export default function StatsPage() {
  return (
    <div className="space-y-2">
      <h1 className="font-mono text-3xl font-semibold tracking-tight">Link stats</h1>
      <p className="text-muted-foreground">Coming in M2.</p>
    </div>
  );
}
