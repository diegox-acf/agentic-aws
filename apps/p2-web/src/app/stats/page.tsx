// /stats/?code=… : the code is a query string because a static export cannot prerender
// /stats/[code] for codes that don't exist yet. StatsView reads it with useSearchParams, which
// must sit inside <Suspense>: the heading is prerendered into the HTML, StatsView renders in
// the browser. Without the boundary, `next build` fails.

import { Suspense } from "react";

import StatsView from "@/components/StatsView";

export default function StatsPage() {
  return (
    <div className="space-y-8">
      <h1 className="font-mono text-3xl font-semibold tracking-tight">Link stats</h1>
      <Suspense>
        <StatsView />
      </Suspense>
    </div>
  );
}
