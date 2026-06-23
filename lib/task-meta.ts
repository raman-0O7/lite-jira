/**
 * Shared presentation helpers for task metadata (Feature 04).
 *
 * Centralizes priority labels/colors and due-date urgency so the card badges
 * and the detail modal stay in sync. Pure functions — no React, no I/O.
 */

import type { Priority } from "@/lib/api/boards";

export const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];

export const PRIORITY_LABEL: Record<Priority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};

/** Tailwind classes for the priority badge / dot, keyed by level. */
export const PRIORITY_BADGE_CLASS: Record<Priority, string> = {
  LOW: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  MEDIUM: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  HIGH: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  URGENT: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};

/** Solid dot color for menus/selects, keyed by level. */
export const PRIORITY_DOT_CLASS: Record<Priority, string> = {
  LOW: "bg-slate-400",
  MEDIUM: "bg-sky-500",
  HIGH: "bg-amber-500",
  URGENT: "bg-red-500",
};

export type DueStatus = "overdue" | "soon" | "normal";

/**
 * Classify a due date relative to "now":
 *   - `overdue` — strictly before the start of today.
 *   - `soon`    — due today or within the next 2 days.
 *   - `normal`  — further out.
 * Compares on calendar days so a task due "today" is never marked overdue.
 */
export function dueStatus(due: Date, now: Date = new Date()): DueStatus {
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const dueDay = new Date(
    due.getFullYear(),
    due.getMonth(),
    due.getDate(),
  ).getTime();
  const oneDay = 24 * 60 * 60 * 1000;

  if (dueDay < startOfToday) return "overdue";
  if (dueDay <= startOfToday + 2 * oneDay) return "soon";
  return "normal";
}

/** Badge classes for a due-date: red if overdue, amber if soon, muted else. */
export function dueBadgeClass(status: DueStatus): string {
  switch (status) {
    case "overdue":
      return "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300";
    case "soon":
      return "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300";
    default:
      return "bg-muted text-muted-foreground";
  }
}

/**
 * Pick readable foreground text (black/white) for an arbitrary hex label color
 * using the WCAG relative-luminance heuristic.
 */
export function readableTextColor(hex: string): string {
  const normalized = hex.replace("#", "");
  const full =
    normalized.length === 3
      ? normalized
          .split("")
          .map((c) => c + c)
          .join("")
      : normalized;
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#000000" : "#ffffff";
}
