"use client";

import { useAppUI } from "@/components/app-shell/app-ui";
import { Kbd } from "@/components/icons/Kbd";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const GROUPS: { title: string; items: { keys: string[]; label: string }[] }[] = [
  {
    title: "General",
    items: [
      { keys: ["⌘", "K"], label: "Search or run a command" },
      { keys: ["?"], label: "Show keyboard shortcuts" },
      { keys: ["Esc"], label: "Close panel or dialog" },
    ],
  },
  {
    title: "Navigation",
    items: [
      { keys: ["G", "P"], label: "Go to projects" },
      { keys: ["G", "S"], label: "Go to settings" },
      { keys: ["G", "B"], label: "Board view" },
      { keys: ["G", "L"], label: "List view" },
    ],
  },
  {
    title: "Issues",
    items: [
      { keys: ["C"], label: "New issue" },
      { keys: ["/"], label: "Filter issues" },
      { keys: ["J"], label: "Next issue (list)" },
      { keys: ["K"], label: "Previous issue (list)" },
      { keys: ["↵"], label: "Open selected issue (list)" },
    ],
  },
];

export function ShortcutsDialog() {
  const { shortcutsOpen, setShortcutsOpen } = useAppUI();
  return (
    <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Shortcuts work anywhere except while typing in a field.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {GROUPS.map((group) => (
            <section key={group.title} className="flex flex-col gap-1">
              <h3 className="text-2xs font-medium text-muted-foreground">{group.title}</h3>
              <ul className="flex flex-col">
                {group.items.map((item) => (
                  <li key={item.label} className="flex h-8 items-center justify-between gap-4 text-sm text-soft">
                    {item.label}
                    <span className="flex items-center gap-1">
                      {item.keys.map((key, index) => (
                        <span key={key} className="flex items-center gap-1">
                          {index > 0 && item.keys[0] === "G" ? (
                            <span className="text-2xs text-muted-foreground">then</span>
                          ) : null}
                          <Kbd>{key}</Kbd>
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
