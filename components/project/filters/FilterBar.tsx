"use client";

import { CalendarClock, CircleDashed, Flag, ListFilter, Search, Tag, UserRound, X } from "lucide-react";

import { Avatar } from "@/components/icons/Avatar";
import { Kbd } from "@/components/icons/Kbd";
import { PriorityIcon } from "@/components/icons/PriorityIcon";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AgentAvatar } from "@/components/issue/AgentBadges";
import type { UseBoardFilters } from "@/hooks/use-board-filters";
import type { AgentStub, LabelStub, PersonStub } from "@/lib/api/projects";
import { DUE_FILTER_LABEL, DUE_FILTERS, UNASSIGNED } from "@/lib/board-filters";
import { PRIORITIES, PRIORITY_LABEL } from "@/lib/task-meta";

/** An assignee filter option: a person or an agent, keyed by its filter token. */
export type AssigneeOption =
  | { token: string; name: string; person: PersonStub }
  | { token: string; name: string; agent: AgentStub };

/** One active filter: "Priority | High, Urgent | ×". */
function FilterChip({
  name,
  value,
  onRemove,
}: {
  name: string;
  value: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex h-6 max-w-72 items-center overflow-hidden rounded-md border bg-field text-xs">
      <span className="border-r px-[7px] text-muted-foreground">{name}</span>
      <span className="truncate px-[7px] text-foreground">{value}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${name.toLowerCase()} filter`}
        className="flex h-full w-[22px] shrink-0 items-center justify-center border-l text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <X className="size-2.5" strokeWidth={2.6} />
      </button>
    </span>
  );
}

/**
 * The 40px filter row above a project view (Feature 05, restyled in 09): a
 * text filter, a "Filter" menu, chips for active filters, and done-progress.
 * Filtering itself is client-side over loaded data (see lib/board-filters.ts).
 */
export function FilterBar({
  labels,
  assignees,
  filters,
  progress,
  searchRef,
}: {
  labels: LabelStub[];
  /** People and agents with issues on this project. */
  assignees: AssigneeOption[];
  filters: UseBoardFilters;
  progress: { done: number; total: number };
  /** The text input, so `/` can focus it. */
  searchRef?: React.Ref<HTMLInputElement>;
}) {
  const {
    filters: state,
    textDraft,
    setText,
    togglePriority,
    toggleLabel,
    toggleDue,
    toggleAssignee,
    update,
    clear,
    count,
  } = filters;
  const labelNames = labels.filter((l) => state.labelIds.includes(l.id)).map((l) => l.name);
  const assigneeNames = state.assignees.map((token) =>
    token === UNASSIGNED ? "Unassigned" : (assignees.find((a) => a.token === token)?.name ?? "Someone"),
  );
  const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-1.5 border-b px-3 py-1.5 md:px-4">
      <label className="relative flex h-6 w-44 items-center">
        <Search className="pointer-events-none absolute left-2 size-3.5 text-icon" />
        <input
          ref={searchRef}
          type="search"
          value={textDraft}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") event.currentTarget.blur();
          }}
          placeholder="Filter issues…"
          aria-label="Filter issues by text"
          className="peer h-full w-full rounded-md border border-transparent bg-transparent pr-7 pl-7 text-xs text-foreground outline-none placeholder:text-muted-foreground hover:bg-accent focus:border-border focus:bg-field [&::-webkit-search-cancel-button]:hidden"
        />
        {textDraft ? (
          <button
            type="button"
            onClick={() => setText("")}
            aria-label="Clear text filter"
            className="absolute right-1 flex size-4 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        ) : (
          <Kbd className="pointer-events-none absolute right-1 peer-focus:hidden">/</Kbd>
        )}
      </label>

      <DropdownMenu>
        <DropdownMenuTrigger className="inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=open]:bg-accent">
          <ListFilter className="size-[13px]" />
          Filter
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <UserRound />
              Assignee
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-72 w-52 overflow-y-auto">
              <DropdownMenuCheckboxItem
                checked={state.assignees.includes(UNASSIGNED)}
                onCheckedChange={() => toggleAssignee(UNASSIGNED)}
                onSelect={(event) => event.preventDefault()}
              >
                <CircleDashed className="text-muted-foreground" />
                Unassigned
              </DropdownMenuCheckboxItem>
              {assignees.map((option) => (
                <DropdownMenuCheckboxItem
                  key={option.token}
                  checked={state.assignees.includes(option.token)}
                  onCheckedChange={() => toggleAssignee(option.token)}
                  onSelect={(event) => event.preventDefault()}
                >
                  {"person" in option ? (
                    <Avatar person={option.person} size="xs" title={false} />
                  ) : (
                    <AgentAvatar name={option.agent.name} kind={option.agent.kind} className="size-4" />
                  )}
                  <span className="truncate">{option.name}</span>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Flag />
              Priority
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-44">
              {[...PRIORITIES].reverse().map((priority) => (
                <DropdownMenuCheckboxItem
                  key={priority}
                  checked={state.priorities.includes(priority)}
                  onCheckedChange={() => togglePriority(priority)}
                  onSelect={(event) => event.preventDefault()}
                >
                  <PriorityIcon priority={priority} decorative />
                  {PRIORITY_LABEL[priority]}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Tag />
              Labels
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-72 w-52 overflow-y-auto">
              {labels.length === 0 ? (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">No labels in use</p>
              ) : (
                labels.map((label) => (
                  <DropdownMenuCheckboxItem
                    key={label.id}
                    checked={state.labelIds.includes(label.id)}
                    onCheckedChange={() => toggleLabel(label.id)}
                    onSelect={(event) => event.preventDefault()}
                  >
                    <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: label.color }} />
                    <span className="truncate">{label.name}</span>
                  </DropdownMenuCheckboxItem>
                ))
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <CalendarClock />
              Due date
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-44">
              {DUE_FILTERS.map((due) => (
                <DropdownMenuCheckboxItem
                  key={due}
                  checked={state.due.includes(due)}
                  onCheckedChange={() => toggleDue(due)}
                  onSelect={(event) => event.preventDefault()}
                >
                  {DUE_FILTER_LABEL[due]}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>

      {assigneeNames.length ? (
        <FilterChip name="Assignee" value={assigneeNames.join(", ")} onRemove={() => update({ assignees: [] })} />
      ) : null}
      {state.priorities.length ? (
        <FilterChip
          name="Priority"
          value={state.priorities.map((p) => PRIORITY_LABEL[p]).join(", ")}
          onRemove={() => update({ priorities: [] })}
        />
      ) : null}
      {labelNames.length ? (
        <FilterChip name="Labels" value={labelNames.join(", ")} onRemove={() => update({ labelIds: [] })} />
      ) : null}
      {state.due.length ? (
        <FilterChip
          name="Due"
          value={state.due.map((d) => DUE_FILTER_LABEL[d]).join(", ")}
          onRemove={() => update({ due: [] })}
        />
      ) : null}
      {count > 1 ? (
        <button
          type="button"
          onClick={clear}
          className="h-6 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          Clear all
        </button>
      ) : null}

      <span
        className="ml-auto inline-flex items-center gap-2 text-xs text-muted-foreground"
        title={`${progress.done} of ${progress.total} issues done`}
      >
        <span
          className="inline-block h-1 w-14 overflow-hidden rounded-full bg-track"
          role="progressbar"
          aria-label="Issues done"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span className="block h-full rounded-full bg-success" style={{ width: `${percent}%` }} />
        </span>
        <span className="tabular">
          {progress.done} / {progress.total} done
        </span>
      </span>
    </div>
  );
}
