"use client";

import { Keyboard, LogOut, Monitor, Moon, MoreHorizontal, Sun } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { useAppUI } from "@/components/app-shell/app-ui";
import { Avatar } from "@/components/icons/Avatar";
import { useTheme } from "@/components/theme/use-theme";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut } from "@/lib/auth-client";
import { isThemePreference } from "@/lib/theme";

type UserMenuProps = {
  user: { id: string; name: string; email: string; image?: string | null };
};

/** The sidebar's bottom row: who's signed in, theme, shortcuts, log out. */
export function UserMenu({ user }: UserMenuProps) {
  const router = useRouter();
  const { preference, setTheme } = useTheme();
  const { setShortcutsOpen } = useAppUI();
  const [isLoading, setIsLoading] = useState(false);

  async function handleLogout() {
    setIsLoading(true);
    await signOut({
      fetchOptions: {
        onError: (ctx) => {
          toast.error(ctx.error.message ?? "Could not sign out.");
        },
      },
    });
    // Send the user to login and refresh so the server layout drops the session.
    router.push("/login");
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Open user menu"
        className="flex h-10 w-full min-w-0 items-center gap-2.5 rounded-md px-1.5 text-left outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=open]:bg-sidebar-accent"
      >
        <Avatar person={{ ...user, image: user.image ?? null }} size="md" title={false} />
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-sm font-medium text-foreground">{user.name || "Account"}</span>
          <span className="truncate text-2xs text-muted-foreground">{user.email}</span>
        </span>
        <MoreHorizontal className="size-4 shrink-0 text-icon" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-56">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={preference}
          onValueChange={(value) => {
            if (isThemePreference(value)) setTheme(value);
          }}
        >
          <DropdownMenuRadioItem value="dark">
            <Moon />
            Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="light">
            <Sun />
            Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor />
            System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setShortcutsOpen(true)}>
          <Keyboard />
          Keyboard shortcuts
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          disabled={isLoading}
          onSelect={(event) => {
            // Keep the menu logic in our handler instead of letting Radix close
            // it before the async sign-out resolves.
            event.preventDefault();
            void handleLogout();
          }}
        >
          <LogOut />
          {isLoading ? "Signing out…" : "Log out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
