import type { PersonStub } from "@/lib/api/projects";
import { cn } from "@/lib/utils";

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts.at(-1)![0] : "")).toUpperCase();
}

/** A person's initials in a circle (images arrive with the redesign). */
export function Avatar({ person, className }: { person: PersonStub; className?: string }) {
  return (
    <span
      title={person.name}
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-semibold text-muted-foreground",
        className,
      )}
    >
      {initials(person.name)}
    </span>
  );
}
