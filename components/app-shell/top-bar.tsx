import Link from "next/link";

import { UserMenu } from "@/components/app-shell/user-menu";

type TopBarProps = {
  user: {
    name: string;
    email: string;
    image?: string | null;
  };
};

export function TopBar({ user }: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link
          href="/boards"
          className="text-base font-semibold tracking-tight"
        >
          Lite Jira
        </Link>
        <UserMenu name={user.name} email={user.email} image={user.image} />
      </div>
    </header>
  );
}
