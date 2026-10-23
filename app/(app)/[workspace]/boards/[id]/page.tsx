import { notFound } from "next/navigation";
import { Suspense } from "react";

import { BoardView } from "@/components/board/BoardView";
import { ctxForWorkspaceSlug } from "@/lib/api/context";
import { getBoard } from "@/lib/services/boards";
import { ServiceError } from "@/lib/services/errors";

// BoardView reads filter state from the URL via useSearchParams, so it must sit
// under a Suspense boundary (otherwise prerendering this route fails the build).
export default async function BoardPage({
  params,
}: PageProps<"/[workspace]/boards/[id]">) {
  const { workspace, id } = await params;
  try {
    const ctx = await ctxForWorkspaceSlug(workspace);
    await getBoard(ctx, id);
  } catch (error) {
    if (error instanceof ServiceError) notFound();
    throw error;
  }
  return (
    <Suspense>
      <BoardView boardId={id} />
    </Suspense>
  );
}
