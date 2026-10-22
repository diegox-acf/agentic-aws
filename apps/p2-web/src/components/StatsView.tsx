"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { ApiError, getStats, type LinkStats, userMessage } from "@/lib/api";

type Outcome = { ok: true; stats: LinkStats } | { ok: false; error: unknown };

// The result is stored together with the request it answers. "Loading" is then derived
// (no result for the current request yet) instead of being set inside the effect, so a
// stale response for an older code or attempt can never be shown.
interface Result {
  requestKey: string;
  outcome: Outcome;
}

const StatsView = () => {
  const code = useSearchParams().get("code");
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const requestKey = `${code}#${attempt}`;

  useEffect(() => {
    if (!code) return;
    let cancelled = false; // set by cleanup: unmounted, or code/attempt changed
    getStats(code).then(
      (stats) => !cancelled && setResult({ requestKey, outcome: { ok: true, stats } }),
      (error: unknown) => !cancelled && setResult({ requestKey, outcome: { ok: false, error } }),
    );
    return () => {
      cancelled = true;
    };
  }, [code, requestKey]);

  if (!code) {
    return <CodeLookup />;
  }

  const outcome = result?.requestKey === requestKey ? result.outcome : null;
  if (outcome === null) {
    return (
      <p role="status" aria-busy="true" className="text-muted-foreground">
        Loading stats for <span className="font-mono">{code}</span>…
      </p>
    );
  }
  if (outcome.ok) {
    return <StatsCard code={code} stats={outcome.stats} />;
  }
  if (outcome.error instanceof ApiError && outcome.error.status === 404) {
    return (
      <div className="space-y-4">
        <p>{userMessage(outcome.error)}</p>
        <Link href="/" className="text-accent underline underline-offset-4">
          Shorten a link
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p role="alert" className="text-destructive">
        {userMessage(outcome.error)}
      </p>
      <button
        type="button"
        onClick={() => setAttempt((n) => n + 1)}
        className="h-11 cursor-pointer rounded-md border border-input-border px-4 text-sm font-medium transition-colors duration-200 hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Try again
      </button>
    </div>
  );
};

export default StatsView;

// A plain GET form: submitting loads /stats/?code=… like any link, no router code needed.
function CodeLookup() {
  return (
    <form action="/stats/" method="get" className="space-y-2">
      <label htmlFor="code" className="block text-sm font-medium">
        Short code
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          id="code"
          name="code"
          required
          pattern="[0-9A-Za-z]{7}"
          title="7 letters or digits"
          autoComplete="off"
          spellCheck={false}
          placeholder="aB3xY9z"
          aria-describedby="code-help"
          className="url-text h-12 min-w-0 flex-1 rounded-md border border-input-border bg-background px-3 font-mono text-base placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />
        <button
          type="submit"
          className="h-12 cursor-pointer rounded-md bg-accent px-6 font-semibold text-on-accent transition-[filter] duration-200 hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Show stats
        </button>
      </div>
      <p id="code-help" className="text-sm text-muted-foreground">
        The 7 characters after the last slash of a short link.
      </p>
    </form>
  );
}

function StatsCard({ code, stats }: { code: string; stats: LinkStats }) {
  return (
    <dl className="grid gap-5 rounded-lg border border-border bg-card p-5 sm:grid-cols-[auto_1fr] sm:gap-x-8">
      <dt className="text-sm text-muted-foreground">Code</dt>
      <dd className="font-mono">{code}</dd>
      <dt className="text-sm text-muted-foreground">Destination</dt>
      <dd className="min-w-0">
        <a
          href={stats.url}
          rel="noopener noreferrer"
          className="url-text font-mono text-accent underline-offset-4 [overflow-wrap:anywhere] hover:underline"
        >
          {stats.url}
        </a>
      </dd>
      <dt className="text-sm text-muted-foreground">Clicks</dt>
      <dd className="font-mono text-3xl font-semibold tabular-nums">{stats.clicks.toLocaleString()}</dd>
      <dt className="text-sm text-muted-foreground">Created</dt>
      <dd>
        <time dateTime={stats.createdAt}>{new Date(stats.createdAt).toLocaleString()}</time>
      </dd>
    </dl>
  );
}
