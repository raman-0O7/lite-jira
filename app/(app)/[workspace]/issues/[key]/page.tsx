import { notFound, redirect } from "next/navigation";

import { ctxForWorkspaceSlug } from "@/lib/api/context";
import { ServiceError } from "@/lib/services/errors";
import { getIssueByKey } from "@/lib/services/issues";

// /acme/issues/WEB-42 → the issue opened on its project's board.
export default async function IssuePage({
  params,
}: PageProps<"/[workspace]/issues/[key]">) {
  const { workspace, key } = await params;
  let issue;
  try {
    issue = await getIssueByKey(await ctxForWorkspaceSlug(workspace), key);
  } catch (error) {
    if (error instanceof ServiceError) notFound();
    throw error;
  }
  redirect(`/${workspace}/projects/${issue.project.key}?issue=${issue.key}`);
}
