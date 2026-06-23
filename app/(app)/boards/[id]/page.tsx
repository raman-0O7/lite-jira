import { Suspense } from "react";

import { BoardView } from "@/components/board/BoardView";

// The (app) layout guards this route and mounts the QueryClient.
// BoardView (client) fetches the board + columns and handles column CRUD/reorder.
//
// F05: BoardView reads filter state from the URL via useSearchParams, so it must
// sit under a Suspense boundary (otherwise a static prerender of this route
// fails the build with the "missing Suspense boundary" error).
export default async function BoardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense>
      <BoardView boardId={id} />
    </Suspense>
  );
}
