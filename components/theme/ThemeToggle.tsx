"use client";

import { Moon, Sun } from "lucide-react";

import { useTheme } from "@/components/theme/use-theme";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Quick dark/light flip for toolbars. */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolved, toggle } = useTheme();
  const label = resolved === "dark" ? "Switch to light theme" : "Switch to dark theme";
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={cn("text-muted-foreground", className)}
    >
      {resolved === "dark" ? <Sun /> : <Moon />}
    </Button>
  );
}
