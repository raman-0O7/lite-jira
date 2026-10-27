import { redirect } from "next/navigation";

// Phase 1 URL.
export default function LegacyBoardsRedirect() {
  redirect("/projects");
}
