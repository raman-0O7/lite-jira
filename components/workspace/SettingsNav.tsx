"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useCan } from "@/components/providers/workspace-provider";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "members", label: "Members" },
  { href: "general", label: "General" },
  { href: "integrations", label: "Integrations" },
  { href: "agents", label: "Agents" },
  // Admins only: the workspace's AI key and model.
  { href: "ai", label: "AI", admin: true },
  { href: "api", label: "API & MCP" },
] as const;

export function SettingsNav({ slug }: { slug: string }) {
  const pathname = usePathname();
  const isAdmin = useCan("workspace.update");
  return (
    // Scrolls sideways on phones, where the tabs don't all fit.
    <nav
      className="ml-2 flex h-7 min-w-0 items-center overflow-x-auto rounded-md bg-chip p-0.5 [scrollbar-width:none]"
      aria-label="Settings"
    >
      {TABS.filter((tab) => !("admin" in tab) || isAdmin).map((tab) => {
        const href = `/${slug}/settings/${tab.href}`;
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={tab.href}
            href={href}
            aria-current={active ? "page" : undefined}
            ref={active ? (el) => el?.scrollIntoView({ block: "nearest", inline: "nearest" }) : undefined}
            className={cn(
              "flex h-6 shrink-0 items-center rounded-[5px] px-2.5 text-xs font-medium transition-colors",
              active ? "bg-seg text-foreground shadow-seg" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
