/**
 * Board filters (Feature 05) — pure predicate functions + URL <-> state
 * serialization. No React, no I/O: trivially unit-testable.
 *
 * Filtering is CLIENT-SIDE over already-loaded board data. These predicates take
 * a task and the current filter state and return whether the task is visible.
 *
 * Combination rule:
 *   - AND across filter *types* (text AND priority AND label AND due), and
 *   - OR *within* a type (priority is LOW or HIGH; label is A or B; …).
 *
 * Degrade gracefully: if a task is missing a metadata field (e.g. no labels, no
 * dueDate, no description), only filters that need that field can exclude it.
 */

import type { Priority, IssueCard } from "@/lib/api/projects";
import { dueStatus } from "@/lib/task-meta";

/** Quick due-date filters, OR-combined within the "due" type. */
export type DueFilter = "overdue" | "week" | "none";

export const DUE_FILTERS: DueFilter[] = ["overdue", "week", "none"];

export const DUE_FILTER_LABEL: Record<DueFilter, string> = {
  overdue: "Overdue",
  week: "Due this week",
  none: "No due date",
};

/** The complete filter state. Empty arrays / empty text mean "no constraint". */
export type FilterState = {
  /** Free text; matched case-insensitively against title + description. */
  text: string;
  /** Selected priorities (OR within). Empty = all priorities pass. */
  priorities: Priority[];
  /** Selected label ids (OR within). Empty = all labels pass. */
  labelIds: string[];
  /** Selected due quick-filters (OR within). Empty = all pass. */
  due: DueFilter[];
};

export const EMPTY_FILTERS: FilterState = {
  text: "",
  priorities: [],
  labelIds: [],
  due: [],
};

/**
 * A task as far as the filters care. The board payload's IssueCard has no
 * `description` (it lives only on the full task fetched in the modal), so we
 * accept it as an optional extra field and degrade gracefully when absent.
 */
export type FilterableTask = IssueCard & { description?: string | null };

// ---------------------------------------------------------------------------
// Predicates (one per filter type) + the combined matcher.
// ---------------------------------------------------------------------------

/** Title + description contains `text` (case-insensitive). Empty text passes. */
export function matchesText(task: FilterableTask, text: string): boolean {
  const needle = text.trim().toLowerCase();
  if (!needle) return true;
  const haystack = `${task.title ?? ""} ${task.description ?? ""}`.toLowerCase();
  return haystack.includes(needle);
}

/** Task priority is one of `priorities`. Empty selection passes everything. */
export function matchesPriority(
  task: FilterableTask,
  priorities: Priority[],
): boolean {
  if (priorities.length === 0) return true;
  return task.priority != null && priorities.includes(task.priority);
}

/** Task carries at least one of `labelIds` (OR). Empty selection passes. */
export function matchesLabels(
  task: FilterableTask,
  labelIds: string[],
): boolean {
  if (labelIds.length === 0) return true;
  const taskLabels = task.labels ?? [];
  return taskLabels.some((l) => labelIds.includes(l.id));
}

/**
 * Task's due-date state matches one of the selected quick-filters (OR).
 *   - overdue: has a due date strictly before today.
 *   - week:    has a due date within the next 7 days (today..+7, not overdue).
 *   - none:    has no due date.
 * Empty selection passes everything.
 */
export function matchesDue(
  task: FilterableTask,
  due: DueFilter[],
  now: Date = new Date(),
): boolean {
  if (due.length === 0) return true;

  const hasDate = task.dueDate != null;
  if (due.includes("none") && !hasDate) return true;
  if (!hasDate) return false;

  const date = new Date(task.dueDate as string);
  if (Number.isNaN(date.getTime())) {
    // Unparseable date: only "none" could ever match, handled above.
    return false;
  }

  const status = dueStatus(date, now);
  if (due.includes("overdue") && status === "overdue") return true;

  if (due.includes("week")) {
    // "Due this week" = due today through the next 7 calendar days, inclusive,
    // and not already overdue. Compared on calendar-day boundaries.
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    ).getTime();
    const dueDay = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
    ).getTime();
    const oneDay = 24 * 60 * 60 * 1000;
    if (dueDay >= startOfToday && dueDay <= startOfToday + 7 * oneDay) {
      return true;
    }
  }

  return false;
}

/** AND across types, OR within each (handled by the per-type predicates). */
export function matchesFilters(
  task: FilterableTask,
  filters: FilterState,
  now: Date = new Date(),
): boolean {
  return (
    matchesText(task, filters.text) &&
    matchesPriority(task, filters.priorities) &&
    matchesLabels(task, filters.labelIds) &&
    matchesDue(task, filters.due, now)
  );
}

/** True when no filter constrains anything (every task passes). */
export function isFiltersEmpty(filters: FilterState): boolean {
  return (
    filters.text.trim() === "" &&
    filters.priorities.length === 0 &&
    filters.labelIds.length === 0 &&
    filters.due.length === 0
  );
}

/**
 * Count of *active filter types* (not individual selections): used for the
 * "N active" badge. Text counts as 1 when non-empty; each non-empty multi-select
 * counts as 1.
 */
export function activeFilterCount(filters: FilterState): number {
  let count = 0;
  if (filters.text.trim() !== "") count += 1;
  if (filters.priorities.length > 0) count += 1;
  if (filters.labelIds.length > 0) count += 1;
  if (filters.due.length > 0) count += 1;
  return count;
}

// ---------------------------------------------------------------------------
// URL <-> state serialization.
// ---------------------------------------------------------------------------
//
// Query params (all optional, omitted when their type is inactive):
//   q        free text
//   priority comma-separated priorities (LOW,HIGH,…)
//   label    comma-separated label ids
//   due      comma-separated due filters (overdue,week,none)
//
// We only own these four keys; any other params on the URL are preserved by the
// hook that applies these (it merges into the existing URLSearchParams).

export const FILTER_PARAM_KEYS = ["q", "priority", "label", "due"] as const;

const VALID_PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];

function splitCsv(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

/** Parse a read-only URLSearchParams-like object into FilterState. */
export function filtersFromSearchParams(
  params: URLSearchParams | { get: (key: string) => string | null },
): FilterState {
  const text = params.get("q") ?? "";

  const priorities = splitCsv(params.get("priority")).filter(
    (p): p is Priority => VALID_PRIORITIES.includes(p as Priority),
  );

  const labelIds = splitCsv(params.get("label"));

  const due = splitCsv(params.get("due")).filter((d): d is DueFilter =>
    DUE_FILTERS.includes(d as DueFilter),
  );

  return { text, priorities, labelIds, due };
}

/**
 * Apply FilterState onto a URLSearchParams, returning a NEW instance. Keys for
 * inactive filter types are removed; unrelated params on the input are kept.
 */
export function filtersToSearchParams(
  filters: FilterState,
  base?: URLSearchParams,
): URLSearchParams {
  const params = new URLSearchParams(base?.toString() ?? "");

  // Clear our keys first so toggling a filter off removes it from the URL.
  for (const key of FILTER_PARAM_KEYS) params.delete(key);

  const trimmedText = filters.text.trim();
  if (trimmedText) params.set("q", trimmedText);
  if (filters.priorities.length) {
    params.set("priority", filters.priorities.join(","));
  }
  if (filters.labelIds.length) params.set("label", filters.labelIds.join(","));
  if (filters.due.length) params.set("due", filters.due.join(","));

  return params;
}
