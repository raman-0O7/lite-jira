import type { PersonStub } from "@/lib/api/projects";
import { colorFor } from "@/lib/colors";
import { cn } from "@/lib/utils";

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts.at(-1)![0] : "")).toUpperCase();
}

const SIZES = {
  xs: "size-4 text-[7px]",
  sm: "size-5 text-[8px]",
  md: "size-6 text-[9px]",
  lg: "size-7 text-[10px]",
} as const;

/** A person: their photo, or initials on a color derived from their id. People are circles. */
export function Avatar({
  person,
  size = "sm",
  className,
  title = true,
}: {
  person: Pick<PersonStub, "id" | "name" | "image">;
  size?: keyof typeof SIZES;
  className?: string;
  /** Show the name on hover (off when the name is printed next to it). */
  title?: boolean;
}) {
  return (
    <span
      title={title ? person.name : undefined}
      aria-hidden={title ? undefined : true}
      style={person.image ? undefined : { backgroundColor: colorFor(person.id) }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full leading-none font-semibold text-white select-none",
        SIZES[size],
        className,
      )}
    >
      {person.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={person.image} alt="" className="size-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        initials(person.name)
      )}
    </span>
  );
}

/** Overlapping avatars with a "+N" for the rest. */
export function AvatarStack({
  people,
  max = 4,
  size = "sm",
}: {
  people: Pick<PersonStub, "id" | "name" | "image">[];
  max?: number;
  size?: keyof typeof SIZES;
}) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span className="flex items-center -space-x-1.5">
      {shown.map((person) => (
        <Avatar key={person.id} person={person} size={size} className="ring-2 ring-background" />
      ))}
      {rest > 0 ? (
        <span
          className={cn(
            "inline-flex items-center justify-center rounded-full bg-chip font-semibold text-muted-foreground ring-2 ring-background",
            SIZES[size],
          )}
          title={people.slice(max).map((p) => p.name).join(", ")}
        >
          +{rest}
        </span>
      ) : null}
    </span>
  );
}
