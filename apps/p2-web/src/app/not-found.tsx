import Link from "next/link";

// Exported as out/404.html. CloudFront maps S3's 403/404 for missing objects to this page.
export default function NotFound() {
  return (
    <div className="space-y-4">
      <h1 className="font-mono text-3xl font-semibold tracking-tight">Page not found</h1>
      <p>
        <Link href="/" className="text-accent underline underline-offset-4">
          Shorten a link
        </Link>
      </p>
    </div>
  );
}
