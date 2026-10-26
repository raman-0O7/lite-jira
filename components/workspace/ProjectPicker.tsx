"use client";

import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ProjectSummary } from "@/lib/api/projects";

/** A checkbox list of projects in a popover, for choosing what a guest can see. */
export function ProjectPicker({
  projects,
  value,
  onChange,
  disabled,
}: {
  projects: Pick<ProjectSummary, "id" | "name" | "key">[];
  value: string[];
  onChange: (projectIds: string[]) => void;
  disabled?: boolean;
}) {
  const selected = new Set(value);
  const label =
    value.length === 0
      ? "No projects"
      : value.length === 1
        ? (projects.find((p) => p.id === value[0])?.name ?? "1 project")
        : `${value.length} projects`;

  function toggle(projectId: string) {
    const next = new Set(selected);
    if (next.has(projectId)) next.delete(projectId);
    else next.add(projectId);
    onChange(projects.filter((p) => next.has(p.id)).map((p) => p.id));
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled} className="justify-between gap-2">
          <span className="truncate">{label}</span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1">
        {projects.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">No projects yet.</p>
        ) : (
          <ul className="max-h-64 overflow-y-auto">
            {projects.map((project) => (
              <li key={project.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent">
                  <input
                    type="checkbox"
                    checked={selected.has(project.id)}
                    onChange={() => toggle(project.id)}
                    className="size-4 accent-primary"
                  />
                  <span className="font-mono text-xs text-muted-foreground">{project.key}</span>
                  <span className="truncate">{project.name}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
