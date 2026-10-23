import { notFound, redirect } from "next/navigation";

import { ctxForBoard } from "@/lib/api/context";
import { ServiceError } from "@/lib/services/errors";
import { workspaceSlugForCtx } from "@/lib/services/workspaces";

// Legacy phase 1 URL: redirect to the board inside its workspace.
export default async function LegacyBoardRedirect({
  params,
}: PageProps<"/boards/[id]">) {
  const { id } = await params;
  let slug: string;
  try {
    slug = await workspaceSlugForCtx(await ctxForBoard(id));
  } catch (error) {
    if (error instanceof ServiceError) notFound();
    throw error;
  }
  redirect(`/${slug}/boards/${id}`);
}
