import type { Metadata } from "next";
import { IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

// next/font downloads the fonts at build time and serves them from our own origin, so the
// static export makes no runtime request to Google.
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "600"],
});

export const metadata: Metadata = {
  title: "Shortener",
  description: "Shorten a URL and see how often it was clicked.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${plexSans.variable} ${jetbrainsMono.variable} h-full antialiased`}>
      <body className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only rounded bg-foreground px-3 py-2 text-background focus:not-sr-only focus:absolute focus:left-4 focus:top-4"
        >
          Skip to content
        </a>
        <header className="border-b border-border">
          <nav className="mx-auto flex w-full max-w-2xl items-center justify-between px-4 py-4">
            <Link href="/" className="font-mono text-lg font-semibold tracking-tight">
              short<span className="text-accent">/</span>link
            </Link>
            <Link href="/stats/" className="text-sm text-muted-foreground hover:text-foreground">
              Stats
            </Link>
          </nav>
        </header>
        <main id="main" className="mx-auto w-full max-w-2xl flex-1 px-4 py-12 sm:py-16">
          {children}
        </main>
      </body>
    </html>
  );
}
