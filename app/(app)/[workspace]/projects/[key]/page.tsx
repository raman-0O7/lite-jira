import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ProjectView } from "@/components/project/ProjectView";
import { ctxForWorkspaceSlug } from "@/lib/api/context";
import { ServiceError } from "@/lib/services/errors";
import { getProjectByKey } from "@/lib/services/projects";

// ProjectView reads filter state from the URL via useSearchParams, so it must sit
// under a Suspense boundary (otherwise prerendering this route fails the build).
export default async function ProjectPage({
  params,
}: PageProps<"/[workspace]/projects/[key]">) {
  const { workspace, key } = await params;
  let project;
  try {
    project = await getProjectByKey(await ctxForWorkspaceSlug(workspace), key);
  } catch (error) {
    if (error instanceof ServiceError) notFound();
    throw error;
  }
  return (
    <Suspense>
      <ProjectView projectId={project.id} />
    </Suspense>
  );
}
