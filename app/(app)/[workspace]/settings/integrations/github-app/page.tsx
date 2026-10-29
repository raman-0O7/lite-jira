import type { Metadata } from "next";
import { Suspense } from "react";

import { GitHubAppCreated } from "@/components/workspace/GitHubAppSetup";

export const metadata: Metadata = { title: "GitHub App" };

export default function GitHubAppCreatedPage() {
  return (
    <Suspense>
      <GitHubAppCreated />
    </Suspense>
  );
}
