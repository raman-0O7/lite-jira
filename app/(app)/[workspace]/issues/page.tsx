import { Suspense } from "react";

import { WorkPageSkeleton } from "@/components/loading/skeletons";
import { IssuesView } from "@/components/work/IssuesView";

export const metadata = { title: "Issues" };

// The [workspace] layout has already checked membership. The view reads
// ?q= and ?filter= from the URL.
export default function IssuesPage() {
  return (
    <Suspense fallback={<WorkPageSkeleton label="Loading issues" />}>
      <IssuesView />
    </Suspense>
  );
}
