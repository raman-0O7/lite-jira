"use client";

import { useQuery } from "@tanstack/react-query";
import { FolderKanban, Plus } from "lucide-react";

import { PageHeader, PageTitle } from "@/components/app-shell/PageHeader";
import { useAppUI } from "@/components/app-shell/app-ui";
import { GetStarted } from "@/components/project/GetStarted";
import { ProjectCard } from "@/components/project/ProjectCard";
import { useCan, useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { fetchProjects, projectKeys } from "@/lib/api/projects";

/** The projects page: one row per project; "New project" opens the shell's dialog. */
export function ProjectList() {
  const { slug, role } = useWorkspace();
  const canCreate = useCan("project.create");
  const { setCreateProjectOpen } = useAppUI();

  const projectsQuery = useQuery({
    queryKey: projectKeys.lists(slug),
    queryFn: () => fetchProjects(slug),
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        actions={
          canCreate ? (
            <Button size="sm" onClick={() => setCreateProjectOpen(true)}>
              <Plus />
              New project
            </Button>
          ) : null
        }
      >
        <PageTitle>Projects</PageTitle>
        {projectsQuery.data ? (
          <span className="text-xs text-muted-foreground tabular">{projectsQuery.data.length}</span>
        ) : null}
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {projectsQuery.data ? <GetStarted projectCount={projectsQuery.data.length} /> : null}
        {projectsQuery.isPending ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">Loading projects…</p>
        ) : projectsQuery.isError ? (
          <div className="flex flex-col items-start gap-3 px-5 py-6">
            <p className="text-sm text-destructive">{(projectsQuery.error as Error).message}</p>
            <Button variant="outline" size="sm" onClick={() => projectsQuery.refetch()}>
              Try again
            </Button>
          </div>
        ) : projectsQuery.data.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-24 text-center">
            <span className="flex size-10 items-center justify-center rounded-xl bg-chip text-icon">
              <FolderKanban className="size-5" />
            </span>
            <p className="font-heading text-[15px] font-semibold">No projects yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              {canCreate
                ? "Create your first project to start tracking issues on a board."
                : role === "GUEST"
                  ? "Nothing has been shared with you here yet."
                  : "There are no projects in this workspace yet."}
            </p>
            {canCreate ? (
              <Button size="sm" onClick={() => setCreateProjectOpen(true)}>
                <Plus />
                New project
              </Button>
            ) : null}
          </div>
        ) : (
          <ul>
            {projectsQuery.data.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
