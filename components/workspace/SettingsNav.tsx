"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const TABS = [
  { href: "members", label: "Members" },
  { href: "general", label: "General" },
  { href: "integrations", label: "Integrations" },
  { href: "api", label: "API & MCP" },
] as const;

export function SettingsNav({ slug }: { slug: string }) {
  const pathname = usePathname();
  return (
    <nav className="ml-2 flex h-7 items-center rounded-md bg-chip p-0.5" aria-label="Settings">
      {TABS.map((tab) => {
        const href = `/${slug}/settings/${tab.href}`;
        const active = pathname === href;
        return (
          <Link
            key={tab.href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-6 items-center rounded-[5px] px-2.5 text-xs font-medium transition-colors",
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
