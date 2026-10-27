"use client";

import { Menu } from "lucide-react";

import { useAppUI } from "@/components/app-shell/app-ui";
import { cn } from "@/lib/utils";

/** A page's 48px toolbar inside the panel: title on the left, actions on the right. */
export function PageHeader({
  children,
  actions,
  className,
}: {
  children: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  const { setSidebarOpen } = useAppUI();
  return (
    <header
      className={cn(
        "flex h-12 shrink-0 items-center gap-2 border-b pr-3 pl-3 md:pl-5",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setSidebarOpen(true)}
        aria-label="Open sidebar"
        className="-ml-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent md:hidden"
      >
        <Menu className="size-4" />
      </button>
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </header>
  );
}

/** The page title in the toolbar (Inter Tight 15/600). */
export function PageTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h1
      className={cn(
        "truncate font-heading text-[15px] font-semibold tracking-[-0.015em] text-foreground",
        className,
      )}
    >
      {children}
    </h1>
  );
}
