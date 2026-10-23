"use client";

import { createContext, useContext } from "react";

import type { WorkspaceSummary } from "@/lib/services/workspaces";

const WorkspaceContext = createContext<WorkspaceSummary | null>(null);

/** Provides the current workspace (from the [workspace] layout) to client components. */
export function WorkspaceProvider({
  workspace,
  children,
}: {
  workspace: WorkspaceSummary;
  children: React.ReactNode;
}) {
  return (
    <WorkspaceContext.Provider value={workspace}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceSummary {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) {
    throw new Error("useWorkspace must be used under app/(app)/[workspace]");
  }
  return workspace;
}
