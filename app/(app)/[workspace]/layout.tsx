import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell/AppShell";
import { WorkspaceProvider } from "@/components/providers/workspace-provider";
import { requireUser } from "@/lib/auth";
import { listWorkspacesForUser } from "@/lib/services/workspaces";

/**
 * Workspace shell. Resolves the caller's membership server-side: a workspace
 * the user doesn't belong to is indistinguishable from one that doesn't exist.
 */
export default async function WorkspaceLayout({
  children,
  params,
}: LayoutProps<"/[workspace]">) {
  const { workspace: slug } = await params;
  const user = await requireUser();
  const workspaces = await listWorkspacesForUser(user.id);
  const workspace = workspaces.find((w) => w.slug === slug);
  if (!workspace) notFound();

  return (
    <WorkspaceProvider workspace={workspace}>
      <AppShell
        workspaces={workspaces}
        user={{ id: user.id, name: user.name, email: user.email, image: user.image }}
      >
        {children}
      </AppShell>
    </WorkspaceProvider>
  );
}
