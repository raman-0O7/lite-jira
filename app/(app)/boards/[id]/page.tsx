import { BoardView } from "@/components/board/BoardView";

// The (app) layout guards this route and mounts the QueryClient.
// BoardView (client) fetches the board + columns and handles column CRUD/reorder.
export default async function BoardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <BoardView boardId={id} />;
}
