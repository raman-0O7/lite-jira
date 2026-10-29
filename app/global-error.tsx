"use client";

import { ErrorState } from "@/components/errors/ErrorState";

import "./globals.css";

// Replaces the root layout when that fails, so it brings its own html and body.
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html lang="en" className="dark h-full">
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <title>Something went wrong · Kanso</title>
        <ErrorState error={error} retry={unstable_retry} />
      </body>
    </html>
  );
}
