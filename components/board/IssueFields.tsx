"use client";

import { useState } from "react";

import { IssueTypeIcon } from "@/components/board/IssueTypeIcon";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Member } from "@/lib/api/members";
import type { IssueType } from "@/lib/api/projects";
import { ISSUE_TYPE_LABEL, ISSUE_TYPES } from "@/lib/task-meta";

// Radix Select can't use "" as an item value, so "none" stands for "cleared".
const NONE = "none";

/** Issue type. Sub-issues can't change type and nothing can become one. */
export function TypeSelect({
  value,
  onChange,
  disabled,
}: {
  value: IssueType;
  onChange: (next: IssueType) => void;
  disabled?: boolean;
}) {
  const locked = value === "SUBTASK";
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next as IssueType)}
      disabled={disabled || locked}
    >
      <SelectTrigger className="w-full" aria-label="Type">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ISSUE_TYPES.filter((t) => t !== "SUBTASK" || locked).map((type) => (
          <SelectItem key={type} value={type}>
            <IssueTypeIcon type={type} />
            {ISSUE_TYPE_LABEL[type]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Workspace members who can be assigned (everyone but guests). */
export function AssigneeSelect({
  value,
  members,
  onChange,
  disabled,
}: {
  value: string | null;
  members: Member[];
  onChange: (next: string | null) => void;
  disabled?: boolean;
}) {
  const assignable = members.filter((m) => m.role !== "GUEST");
  return (
    <Select
      value={value ?? NONE}
      onValueChange={(next) => onChange(next === NONE ? null : next)}
      disabled={disabled}
    >
      <SelectTrigger className="w-full" aria-label="Assignee">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>Unassigned</SelectItem>
        {assignable.map((member) => (
          <SelectItem key={member.id} value={member.id}>
            {member.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The project's epics. */
export function EpicSelect({
  value,
  epics,
  onChange,
  disabled,
}: {
  value: string | null;
  epics: { id: string; key: string; title: string }[];
  onChange: (next: string | null) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value ?? NONE}
      onValueChange={(next) => onChange(next === NONE ? null : next)}
      disabled={disabled}
    >
      <SelectTrigger className="w-full" aria-label="Epic">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>No epic</SelectItem>
        {epics.map((epic) => (
          <SelectItem key={epic.id} value={epic.id}>
            <IssueTypeIcon type="EPIC" />
            <span className="font-mono text-xs text-muted-foreground">{epic.key}</span>
            <span className="truncate">{epic.title}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Story points, 0–100; empty clears. Commits on blur / Enter. */
export function EstimateInput({
  value,
  onChange,
  disabled,
}: {
  value: number | null;
  onChange: (next: number | null) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    setDraft(value === null ? "" : String(value));
  }

  function commit() {
    const trimmed = draft.trim();
    const next = trimmed === "" ? null : Number(trimmed);
    if (next !== null && (!Number.isInteger(next) || next < 0 || next > 100)) {
      setDraft(value === null ? "" : String(value));
      return;
    }
    if (next !== value) onChange(next);
  }

  return (
    <Input
      type="number"
      inputMode="numeric"
      min={0}
      max={100}
      value={draft}
      placeholder="Points"
      aria-label="Estimate in points"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      disabled={disabled}
    />
  );
}
