"use client";

import { type FormEvent, useId, useRef, useState } from "react";

import { createLink, type ShortLink, userMessage } from "@/lib/api";
import { validateUrl } from "@/lib/validation";

import { ShortLinkResult } from "./ShortLinkResult";

export function ShortenForm() {
  const [url, setUrl] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ShortLink | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const helpId = useId();
  const errorId = useId();
  const error = fieldError ?? apiError;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setApiError(null);
    setResult(null);
    const check = validateUrl(url);
    if (!check.ok) {
      setFieldError(check.error);
      inputRef.current?.focus();
      return;
    }
    setPending(true);
    try {
      setResult(await createLink(check.url));
    } catch (err: unknown) {
      setApiError(userMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* noValidate: our messages replace the browser's; type="url" still brings the URL keyboard. */}
      <form onSubmit={handleSubmit} noValidate className="space-y-2">
        <label htmlFor="url" className="block text-sm font-medium">
          URL to shorten
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            ref={inputRef}
            id="url"
            name="url"
            type="url"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            placeholder="https://example.com/a/long/path"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setFieldError(null);
              setApiError(null);
            }}
            aria-invalid={fieldError !== null}
            aria-describedby={error ? `${helpId} ${errorId}` : helpId}
            className="url-text h-12 min-w-0 flex-1 rounded-md border border-input-border bg-background px-3 font-mono text-base placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-invalid:border-destructive"
          />
          <button
            type="submit"
            disabled={pending}
            className="h-12 cursor-pointer rounded-md bg-accent px-6 font-semibold text-on-accent transition-[filter,opacity] duration-200 hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Shortening…" : "Shorten"}
          </button>
        </div>
        <p id={helpId} className="text-sm text-muted-foreground">
          http or https, up to 2048 bytes. Links expire after 30 days.
        </p>
        {error && (
          <p id={errorId} role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </form>

      <p role="status" className="sr-only">
        {result ? "Short link ready." : ""}
      </p>
      {result && <ShortLinkResult link={result} />}
    </div>
  );
}
