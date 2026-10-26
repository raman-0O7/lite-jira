import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { IssuePage } from "@/components/issue/IssuePage";
import { ctxForWorkspaceSlug } from "@/lib/api/context";
import { ServiceError } from "@/lib/services/errors";
import { getIssueByKey } from "@/lib/services/issues";

// One lookup per request, shared by the metadata and the page.
const loadIssue = cache(async (workspace: string, key: string) => {
  try {
    return await getIssueByKey(await ctxForWorkspaceSlug(workspace), key);
  } catch (error) {
    if (error instanceof ServiceError) notFound();
    throw error;
  }
});

export async function generateMetadata({ params }: PageProps<"/[workspace]/issues/[key]">): Promise<Metadata> {
  const { workspace, key } = await params;
  const issue = await loadIssue(workspace, key);
  return { title: `${issue.key} ${issue.title}` };
}

// /acme/issues/WEB-42 → the issue as a full page.
export default async function Page({ params }: PageProps<"/[workspace]/issues/[key]">) {
  const { workspace, key } = await params;
  const issue = await loadIssue(workspace, key);
  return (
    <IssuePage
      issueId={issue.id}
      issueKey={issue.key}
      projectId={issue.projectId}
      project={{ key: issue.project.key, name: issue.project.name }}
    />
  );
}
