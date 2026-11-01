"use client";

import { ErrorState } from "@/components/errors/ErrorState";

// Errors inside a workspace page keep the sidebar around them.
export default function WorkspaceError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return <ErrorState error={error} retry={unstable_retry} />;
}
