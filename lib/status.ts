import type { ColumnCategory } from "@/lib/api/projects";

/**
 * How a column's status icon looks. Categories drive it: to do, in progress,
 * done. When a project has several in-progress columns, the later ones read as
 * further along ("review": three-quarter circle).
 */
export type StatusVariant = "todo" | "started" | "review" | "done";

export function statusVariants(
  columns: { id: string; category: ColumnCategory }[],
): Map<string, StatusVariant> {
  const variants = new Map<string, StatusVariant>();
  let inProgressSeen = 0;
  for (const column of columns) {
    if (column.category === "TODO") variants.set(column.id, "todo");
    else if (column.category === "DONE") variants.set(column.id, "done");
    else variants.set(column.id, inProgressSeen++ === 0 ? "started" : "review");
  }
  return variants;
}

export function variantForCategory(category: ColumnCategory): StatusVariant {
  return category === "TODO" ? "todo" : category === "DONE" ? "done" : "started";
}

export const CATEGORY_LABEL: Record<ColumnCategory, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  DONE: "Done",
};
