import Link from "next/link";

import { UserMenu } from "@/components/app-shell/user-menu";
import { WorkspaceSwitcher } from "@/components/workspace/WorkspaceSwitcher";
import type { WorkspaceSummary } from "@/lib/services/workspaces";

type TopBarProps = {
  workspace: WorkspaceSummary;
  workspaces: WorkspaceSummary[];
  user: {
    name: string;
    email: string;
    image?: string | null;
  };
};

export function TopBar({ workspace, workspaces, user }: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href={`/${workspace.slug}/projects`}
            className="text-base font-semibold tracking-tight"
          >
            Kanso
          </Link>
          <span className="text-muted-foreground" aria-hidden="true">
            /
          </span>
          <WorkspaceSwitcher current={workspace} workspaces={workspaces} />
        </div>
        <UserMenu name={user.name} email={user.email} image={user.image} />
      </div>
    </header>
  );
}
