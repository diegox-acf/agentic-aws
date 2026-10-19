// /stats/?code=… : the code is a query string because a static export cannot prerender
// /stats/[code] for codes that don't exist yet. The client component that reads it with
// useSearchParams must sit inside <Suspense> (M2), or the export fails.
export default function StatsPage() {
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-16">
      <h1 className="text-3xl font-semibold">Link stats</h1>
      <p className="mt-2 text-sm opacity-70">The stats view arrives in M2.</p>
    </main>
  );
}
