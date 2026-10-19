"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { ShortLink } from "@/lib/api";

type CopyState = "idle" | "copied" | "failed";

const COPIED_RESET_MS = 2000;

export function ShortLinkResult({ link }: { link: ShortLink }) {
  const [copy, setCopy] = useState<CopyState>("idle");

  useEffect(() => {
    if (copy !== "copied") return;
    const timer = setTimeout(() => setCopy("idle"), COPIED_RESET_MS);
    return () => clearTimeout(timer);
  }, [copy]);

  async function handleCopy() {
    try {
      // navigator.clipboard only exists on HTTPS pages and localhost.
      await navigator.clipboard.writeText(link.shortUrl);
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  }

  return (
    <section aria-label="Your short link" className="rounded-lg border border-border bg-card p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <a
          href={link.shortUrl}
          className="url-text min-w-0 flex-1 font-mono text-base text-accent underline-offset-4 [overflow-wrap:anywhere] hover:underline"
        >
          {link.shortUrl}
        </a>
        <button
          type="button"
          onClick={handleCopy}
          className="h-11 cursor-pointer rounded-md border border-input-border px-4 text-sm font-medium transition-colors duration-200 hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {copy === "copied" ? "Copied" : "Copy"}
        </button>
      </div>
      {copy === "failed" && (
        <p className="mt-3 text-sm text-muted-foreground">
          Your browser blocked the clipboard. Select the link and copy it by hand.
        </p>
      )}
      <p className="mt-4 text-sm">
        <Link
          href={`/stats/?code=${link.code}`}
          className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          View stats
        </Link>
      </p>
    </section>
  );
}
