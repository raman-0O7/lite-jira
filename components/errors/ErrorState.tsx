"use client";

import { TriangleAlert } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/**
 * What an error boundary shows. A browser error keeps its message, so it can
 * be reported; a server error arrives as Next's generic message plus a digest
 * that matches the server log, never the details.
 */
export function ErrorState({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="mx-auto flex w-full max-w-md flex-col items-center gap-3 px-6 py-16 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-danger/10">
        <TriangleAlert className="size-5 text-danger" />
      </span>
      <h1 className="font-heading text-base font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">Try again. If it keeps happening, send us the details below.</p>
      <pre className="w-full overflow-auto rounded-md border bg-chip p-3 text-left font-mono text-xs break-words whitespace-pre-wrap text-muted-foreground">
        {error.message || "Unknown error"}
        {error.digest ? `\nRef: ${error.digest}` : ""}
      </pre>
      <div className="flex gap-2">
        <Button size="sm" onClick={retry}>
          Try again
        </Button>
        <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
          Reload page
        </Button>
      </div>
    </div>
  );
}
