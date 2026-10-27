import { notFound, redirect } from "next/navigation";

import { ctxForProject } from "@/lib/api/context";
import { ServiceError } from "@/lib/services/errors";
import { getProject } from "@/lib/services/projects";
import { workspaceSlugForCtx } from "@/lib/services/workspaces";

// Phase 1 URL (board ids are project ids): redirect to the project in its workspace.
export default async function LegacyBoardRedirect({
  params,
}: PageProps<"/boards/[id]">) {
  const { id } = await params;
  let target: string;
  try {
    const ctx = await ctxForProject(id);
    const project = await getProject(ctx, id);
    target = `/${await workspaceSlugForCtx(ctx)}/projects/${project.key}`;
  } catch (error) {
    if (error instanceof ServiceError) notFound();
    throw error;
  }
  redirect(target);
}
