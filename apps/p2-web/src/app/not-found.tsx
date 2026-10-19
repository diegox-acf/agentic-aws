import Link from "next/link";

// Exported as out/404.html. CloudFront maps S3's 403/404 for missing objects to this page.
export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-16">
      <h1 className="text-3xl font-semibold">Page not found</h1>
      <p className="mt-4">
        <Link href="/" className="underline">
          Shorten a link
        </Link>
      </p>
    </main>
  );
}
