import Link from "next/link";

import { UserMenu } from "@/components/app-shell/user-menu";
import type { WorkspaceSummary } from "@/lib/services/workspaces";

type TopBarProps = {
  workspace: Pick<WorkspaceSummary, "name" | "slug" | "personal">;
  user: {
    name: string;
    email: string;
    image?: string | null;
  };
};

export function TopBar({ workspace, user }: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href={`/${workspace.slug}/boards`}
            className="text-base font-semibold tracking-tight"
          >
            Kanso
          </Link>
          <span className="text-muted-foreground" aria-hidden="true">
            /
          </span>
          <span className="truncate text-sm font-medium">
            {workspace.personal ? "Personal" : workspace.name}
          </span>
        </div>
        <UserMenu name={user.name} email={user.email} image={user.image} />
      </div>
    </header>
  );
}
