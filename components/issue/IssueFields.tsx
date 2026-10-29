"use client";

import { Check, ChevronDown, Circle, Layers, Sparkles, UserPlus, UserRound } from "lucide-react";
import { useState } from "react";

import { AgentIcon } from "@/components/icons/AgentIcon";
import { Avatar } from "@/components/icons/Avatar";
import { IssueTypeIcon } from "@/components/icons/IssueTypeIcon";
import { PriorityIcon } from "@/components/icons/PriorityIcon";
import { StatusIcon } from "@/components/icons/StatusIcon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Member } from "@/lib/api/members";
import type { AgentStub, ColumnCategory, IssueType, Priority } from "@/lib/api/projects";
import { type StatusVariant, variantForCategory } from "@/lib/status";
import { ISSUE_TYPE_LABEL, ISSUE_TYPES, PRIORITIES, PRIORITY_LABEL } from "@/lib/task-meta";
import { cn } from "@/lib/utils";

/**
 * Property pickers for issues. Each is a menu behind a trigger that looks like
 * a compact pill (new-issue dialog) or a full-width row (the properties rail).
 */
export type PickerLook = "pill" | "row";

const TRIGGER: Record<PickerLook, string> = {
  pill: "h-7 gap-1.5 rounded-md border bg-transparent px-2 text-xs font-medium text-soft hover:bg-accent",
  row: "h-[30px] w-full gap-2 rounded-md px-2 text-sm text-foreground hover:bg-accent",
};

function Picker({
  look,
  label,
  disabled,
  trigger,
  children,
  contentClassName,
}: {
  look: PickerLook;
  /** Accessible name, e.g. "Priority". */
  label: string;
  disabled?: boolean;
  trigger: React.ReactNode;
  children: React.ReactNode;
  contentClassName?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        aria-label={label}
        className={cn(
          "group/picker flex min-w-0 items-center text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-default disabled:hover:bg-transparent data-[state=open]:bg-accent [&_svg]:shrink-0",
          TRIGGER[look],
        )}
      >
        {trigger}
        {look === "pill" ? null : (
          <ChevronDown className="ml-auto size-3.5 text-muted-foreground opacity-0 group-hover/picker:opacity-100 group-disabled/picker:hidden" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={cn("w-52", contentClassName)}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Option({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenuItem onSelect={onSelect}>
      {children}
      {selected ? <Check className="ml-auto size-3.5" /> : null}
    </DropdownMenuItem>
  );
}

export function StatusPicker({
  columns,
  value,
  onChange,
  variants,
  look = "row",
  disabled,
}: {
  columns: { id: string; name: string; category: ColumnCategory }[];
  value: string | null;
  onChange: (columnId: string) => void;
  variants?: Map<string, StatusVariant>;
  look?: PickerLook;
  disabled?: boolean;
}) {
  const current = columns.find((c) => c.id === value);
  const variantOf = (c: { id: string; category: ColumnCategory }) =>
    variants?.get(c.id) ?? variantForCategory(c.category);
  return (
    <Picker
      look={look}
      label="Status"
      disabled={disabled}
      trigger={
        current ? (
          <>
            <StatusIcon variant={variantOf(current)} />
            <span className="truncate">{current.name}</span>
          </>
        ) : (
          <>
            <Circle className="size-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">Status</span>
          </>
        )
      }
    >
      {columns.map((column) => (
        <Option key={column.id} selected={column.id === value} onSelect={() => onChange(column.id)}>
          <StatusIcon variant={variantOf(column)} />
          <span className="truncate">{column.name}</span>
        </Option>
      ))}
    </Picker>
  );
}

export function PriorityPicker({
  value,
  onChange,
  look = "row",
  disabled,
}: {
  value: Priority;
  onChange: (next: Priority) => void;
  look?: PickerLook;
  disabled?: boolean;
}) {
  return (
    <Picker
      look={look}
      label="Priority"
      disabled={disabled}
      trigger={
        <>
          <PriorityIcon priority={value} decorative />
          <span className="truncate">{PRIORITY_LABEL[value]}</span>
        </>
      }
    >
      {[...PRIORITIES].reverse().map((priority) => (
        <Option key={priority} selected={priority === value} onSelect={() => onChange(priority)}>
          <PriorityIcon priority={priority} decorative />
          {PRIORITY_LABEL[priority]}
        </Option>
      ))}
    </Picker>
  );
}

/** Issue type. Sub-issues can't change type and nothing can become one. */
export function TypePicker({
  value,
  onChange,
  look = "row",
  disabled,
}: {
  value: IssueType;
  onChange: (next: IssueType) => void;
  look?: PickerLook;
  disabled?: boolean;
}) {
  const locked = value === "SUBTASK";
  return (
    <Picker
      look={look}
      label="Type"
      disabled={disabled || locked}
      trigger={
        <>
          <IssueTypeIcon type={value} decorative />
          <span className="truncate">{ISSUE_TYPE_LABEL[value]}</span>
        </>
      }
    >
      {ISSUE_TYPES.filter((t) => t !== "SUBTASK").map((type) => (
        <Option key={type} selected={type === value} onSelect={() => onChange(type)}>
          <IssueTypeIcon type={type} decorative />
          {ISSUE_TYPE_LABEL[type]}
        </Option>
      ))}
    </Picker>
  );
}

/**
 * Ways to grow the assignee list from inside the menu
 * (docs/features/13-guided-setup.md "Assignee menu"): actions for admins, a
 * hint for everyone else.
 */
export type AssigneeShortcuts = { onInvite?: () => void; onAddAgent?: () => void; hint?: string };

/**
 * Workspace members who can be assigned (everyone but guests), and, when
 * `agents` is given, the agents the viewer can hand the issue to. The person
 * stays the assignee while an agent works it
 * (docs/features/17-personal-agents.md).
 */
export function AssigneePicker({
  value,
  members,
  onChange,
  agents,
  agentValue = null,
  onAgentChange,
  shortcuts,
  look = "row",
  disabled,
}: {
  value: string | null;
  members: Member[];
  onChange: (next: string | null) => void;
  agents?: (AgentStub & { enabled?: boolean })[];
  /** The agent working the issue for the assignee, if any. */
  agentValue?: AgentStub | null;
  /** null takes the agent off; the person stays. */
  onAgentChange?: (agentId: string | null) => void;
  shortcuts?: AssigneeShortcuts;
  look?: PickerLook;
  disabled?: boolean;
}) {
  const assignable = members.filter((m) => m.role !== "GUEST");
  const current = members.find((m) => m.id === value);
  const pickable = (agents ?? []).filter((a) => a.enabled !== false || a.id === agentValue?.id);
  return (
    <Picker
      look={look}
      label="Assignee"
      disabled={disabled}
      contentClassName="max-h-72 overflow-y-auto"
      trigger={
        current ? (
          <>
            <Avatar person={current} size="xs" title={false} />
            <span className="truncate">{current.name}</span>
            {agentValue ? <AgentTag agent={agentValue} /> : null}
          </>
        ) : agentValue ? (
          <>
            <AgentIcon kind={agentValue.kind} className="size-3.5" />
            <span className="truncate">{agentValue.name}</span>
          </>
        ) : (
          <>
            <UserRound className="size-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">{look === "pill" ? "Assignee" : "Unassigned"}</span>
          </>
        )
      }
    >
      <Option selected={value === null} onSelect={() => onChange(null)}>
        <UserRound className="text-muted-foreground" />
        Unassigned
      </Option>
      {assignable.map((member) => (
        <Option key={member.id} selected={member.id === value} onSelect={() => onChange(member.id)}>
          <Avatar person={member} size="xs" title={false} />
          <span className="truncate">{member.name}</span>
        </Option>
      ))}
      {onAgentChange && pickable.length ? (
        <>
          <div className="px-2 pt-2 pb-1 text-2xs font-medium text-muted-foreground">Hand to an agent</div>
          {pickable.map((agent) => (
            <Option key={agent.id} selected={agent.id === agentValue?.id} onSelect={() => onAgentChange(agent.id)}>
              <AgentIcon kind={agent.kind} />
              <span className="truncate">{agent.name}</span>
            </Option>
          ))}
          {agentValue ? (
            <Option selected={false} onSelect={() => onAgentChange(null)}>
              <UserRound className="text-muted-foreground" />
              No agent
            </Option>
          ) : null}
        </>
      ) : null}
      {shortcuts?.onInvite || shortcuts?.onAddAgent || shortcuts?.hint ? <DropdownMenuSeparator /> : null}
      {shortcuts?.onInvite ? (
        <DropdownMenuItem onSelect={shortcuts.onInvite}>
          <UserPlus className="text-muted-foreground" />
          Invite people…
        </DropdownMenuItem>
      ) : null}
      {shortcuts?.onAddAgent ? (
        <DropdownMenuItem onSelect={shortcuts.onAddAgent}>
          <Sparkles className="text-primary-text" />
          Add your AI agent…
        </DropdownMenuItem>
      ) : null}
      {shortcuts?.hint ? <p className="px-2 py-1.5 text-2xs text-muted-foreground">{shortcuts.hint}</p> : null}
    </Picker>
  );
}

/** "· Claude" after the assignee's name while their agent works the issue. */
function AgentTag({ agent }: { agent: AgentStub }) {
  return (
    <span className="flex min-w-0 shrink items-center gap-1 text-muted-foreground" title={`${agent.name} is working on it`}>
      <span aria-hidden>·</span>
      <AgentIcon kind={agent.kind} className="size-3 shrink-0" />
      <span className="truncate">{agent.name}</span>
    </span>
  );
}

/** The project's epics. */
export function EpicPicker({
  value,
  epics,
  onChange,
  look = "row",
  disabled,
}: {
  value: string | null;
  epics: { id: string; key: string; title: string }[];
  onChange: (next: string | null) => void;
  look?: PickerLook;
  disabled?: boolean;
}) {
  const current = epics.find((e) => e.id === value);
  return (
    <Picker
      look={look}
      label="Epic"
      disabled={disabled}
      contentClassName="w-64 max-h-72 overflow-y-auto"
      trigger={
        current ? (
          <>
            <IssueTypeIcon type="EPIC" decorative />
            <span className="truncate">{current.title}</span>
          </>
        ) : (
          <>
            <Layers className="size-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">No epic</span>
          </>
        )
      }
    >
      <Option selected={value === null} onSelect={() => onChange(null)}>
        <Layers className="text-muted-foreground" />
        No epic
      </Option>
      {epics.map((epic) => (
        <Option key={epic.id} selected={epic.id === value} onSelect={() => onChange(epic.id)}>
          <IssueTypeIcon type="EPIC" decorative />
          <span className="font-mono text-2xs text-muted-foreground">{epic.key}</span>
          <span className="truncate">{epic.title}</span>
        </Option>
      ))}
    </Picker>
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
    <input
      type="number"
      inputMode="numeric"
      min={0}
      max={100}
      value={draft}
      placeholder="No estimate"
      aria-label="Estimate in points"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      disabled={disabled}
      className="h-[30px] w-full rounded-md border border-transparent bg-transparent px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground hover:bg-accent focus:border-border focus:bg-field disabled:hover:bg-transparent [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
    />
  );
}
