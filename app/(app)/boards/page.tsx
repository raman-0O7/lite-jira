import { BoardList } from "@/components/board/BoardList";

// The (app) layout already guards this route and mounts the QueryClient.
// BoardList is a client component that fetches via TanStack Query.
export default function BoardsPage() {
  return <BoardList />;
}
