/**
 * Shared presentation helpers for task metadata (Feature 04).
 *
 * Centralizes priority labels/colors and due-date urgency so the card badges
 * and the detail modal stay in sync. Pure functions — no React, no I/O.
 */

import type { IssueType, Priority } from "@/lib/api/projects";

export const ISSUE_TYPES: IssueType[] = ["EPIC", "STORY", "TASK", "BUG", "SUBTASK"];

export const ISSUE_TYPE_LABEL: Record<IssueType, string> = {
  EPIC: "Epic",
  STORY: "Story",
  TASK: "Task",
  BUG: "Bug",
  SUBTASK: "Sub-issue",
};

export const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];

export const PRIORITY_LABEL: Record<Priority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
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
