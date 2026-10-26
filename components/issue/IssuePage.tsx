"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Link2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { PageHeader, PageTitle } from "@/components/app-shell/PageHeader";
import { ProjectTile } from "@/components/icons/ProjectTile";
import { IssueDetail } from "@/components/issue/IssueDetail";
import { copyIssueLink } from "@/components/issue/IssuePanel";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { Button } from "@/components/ui/button";
import { deleteIssue } from "@/lib/api/issues";
import { projectKeys } from "@/lib/api/projects";

/** /[workspace]/issues/[key]: breadcrumb toolbar over the shared issue detail. */
export function IssuePage({
  issueId,
  issueKey,
  projectId,
  project,
}: {
  issueId: string;
  issueKey: string;
  projectId: string;
  project: { key: string; name: string };
}) {
  const { slug } = useWorkspace();
  const router = useRouter();
  const queryClient = useQueryClient();
  const projectHref = `/${slug}/projects/${project.key}`;

  const remove = useMutation({
    mutationFn: () => deleteIssue(issueId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
      toast.success(`${issueKey} deleted.`);
      router.push(projectHref);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        actions={
          <>
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => copyIssueLink(slug, issueKey)}>
              <Link2 />
              <span className="hidden sm:inline">Copy link</span>
            </Button>
            <ThemeToggle />
          </>
        }
      >
        <Link href={projectHref} className="flex min-w-0 items-center gap-2 text-soft hover:text-foreground">
          <ProjectTile projectKey={project.key} name={project.name} size="md" />
          <span className="hidden truncate text-sm font-medium sm:inline">{project.name}</span>
        </Link>
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <PageTitle className="font-mono text-sm tracking-normal">{issueKey}</PageTitle>
      </PageHeader>
      <IssueDetail
        key={issueId}
        issueId={issueId}
        projectId={projectId}
        onNavigate={(key) => router.push(`/${slug}/issues/${key}`)}
        onDelete={() => remove.mutate()}
      />
    </div>
  );
}
