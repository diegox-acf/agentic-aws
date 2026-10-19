import { ShortenForm } from "@/components/ShortenForm";

export default function HomePage() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="font-mono text-3xl font-semibold tracking-tight text-balance">
          Shorten a link
        </h1>
        <p className="text-muted-foreground">
          Paste a long URL, get a short one, and see how many times it was opened.
        </p>
      </div>
      <ShortenForm />
    </div>
  );
}
