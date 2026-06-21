"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

/**
 * Mounts a single TanStack Query client for the protected app shell.
 *
 * The client is created once per browser session via `useState` so it isn't
 * recreated on every render (which would drop the cache). F01 did not set up a
 * provider; this is the first one in the tree and is mounted in the (app)
 * layout so all board/column/task data fetching shares one cache.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
