"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const TABS = [
  { href: "members", label: "Members" },
  { href: "general", label: "General" },
] as const;

export function SettingsNav({ slug }: { slug: string }) {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 border-b" aria-label="Settings">
      {TABS.map((tab) => {
        const href = `/${slug}/settings/${tab.href}`;
        const active = pathname === href;
        return (
          <Link
            key={tab.href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
              active
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
