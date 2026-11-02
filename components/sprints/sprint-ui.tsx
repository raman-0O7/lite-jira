"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import { Check, IterationCcw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { issueKeys, updateIssue } from "@/lib/api/issues";
import { projectKeys } from "@/lib/api/projects";
import {
  completeSprint,
  daysLeft,
  fetchSprints,
  type Sprint,
  sprintKeys,
  type SprintTotals,
  startSprint,
  updateSprint,
} from "@/lib/api/sprints";
import { cn } from "@/lib/utils";

/** Everything a sprint change can touch: the board, backlog, reports, and open issues. */
export function useRefreshSprints(projectId: string) {
  const queryClient = useQueryClient();
  return (issueIds: string[] = []) => {
    queryClient.invalidateQueries({ queryKey: ["sprints", projectId] });
    queryClient.invalidateQueries({ queryKey: ["sprint-burndown"] });
    queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
    queryClient.invalidateQueries({ queryKey: ["issue-search"] });
    for (const id of issueIds) queryClient.invalidateQueries({ queryKey: issueKeys.detail(id) });
  };
}

const shortDate = (value: string | null) => (value ? format(new Date(value), "MMM d") : "—");

/** "Nov 2 – Nov 16 · 6 days left" */
export function sprintDates(sprint: Pick<Sprint, "startDate" | "endDate" | "state">) {
  if (!sprint.startDate || !sprint.endDate) return null;
  const range = `${shortDate(sprint.startDate)} – ${shortDate(sprint.endDate)}`;
  if (sprint.state !== "ACTIVE") return range;
  const left = daysLeft(sprint.endDate);
  if (left === null) return range;
  const tail = left > 1 ? `${left} days left` : left === 1 ? "1 day left" : left === 0 ? "ends today" : "overdue";
  return `${range} · ${tail}`;
}

/** "3/8 issues" or "5/13 pts", whichever the sprint is measured in. */
export function sprintProgress(totals: SprintTotals) {
  return totals.points > 0
    ? { done: totals.donePoints, total: totals.points, unit: "pts" }
    : { done: totals.doneIssues, total: totals.issues, unit: totals.issues === 1 ? "issue" : "issues" };
}

/**
 * "Move to": any open sprint, or the backlog. Used on backlog rows and the
 * issue panel's Sprint property.
 */
export function MoveToSprintMenu({
  projectId,
  issueId,
  currentSprintId,
  trigger,
  disabled,
}: {
  projectId: string;
  issueId: string;
  currentSprintId: string | null;
  trigger: React.ReactNode;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const sprints = useQuery({
    queryKey: sprintKeys.list(projectId),
    queryFn: () => fetchSprints(projectId),
    enabled: open,
  });
  const refresh = useRefreshSprints(projectId);
  const move = useMutation({
    mutationFn: (sprintId: string | null) => updateIssue(issueId, { sprintId }),
    onSuccess: (issue) => {
      refresh([issueId]);
      toast.success(issue.sprint ? `${issue.key} moved to ${issue.sprint.name}` : `${issue.key} moved to the backlog`);
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const choices = (sprints.data ?? []).filter((s) => s.state !== "CLOSED");

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild disabled={disabled || move.isPending}>
        {trigger}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>Move to</DropdownMenuLabel>
        {sprints.isPending ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">Loading sprints…</p>
        ) : (
          choices.map((sprint) => (
            <DropdownMenuItem
              key={sprint.id}
              disabled={sprint.id === currentSprintId}
              onSelect={() => move.mutate(sprint.id)}
            >
              <IterationCcw className="text-icon" />
              <span className="min-w-0 flex-1 truncate">{sprint.name}</span>
              {sprint.state === "ACTIVE" ? <span className="text-2xs text-muted-foreground">Active</span> : null}
              {sprint.id === currentSprintId ? <Check className="size-3.5" /> : null}
            </DropdownMenuItem>
          ))
        )}
        {sprints.isSuccess && choices.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">No open sprints. Create one in the backlog.</p>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={currentSprintId === null} onSelect={() => move.mutate(null)}>
          <span className="min-w-0 flex-1">Backlog</span>
          {currentSprintId === null ? <Check className="size-3.5" /> : null}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const DURATIONS = [1, 2, 3, 4] as const;
const isoDay = (date: Date) => format(date, "yyyy-MM-dd");
/** A local yyyy-MM-dd as the UTC midnight the server stores. */
const fromDay = (day: string) => new Date(`${day}T00:00:00.000Z`).toISOString();

/** Start a planned sprint: name, goal, and dates (default two weeks from today). */
export function StartSprintDialog({
  projectId,
  sprint,
  onOpenChange,
}: {
  projectId: string;
  sprint: (Sprint & { issueCount: number }) | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={sprint !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {sprint ? <StartSprintForm key={sprint.id} projectId={projectId} sprint={sprint} close={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function StartSprintForm({
  projectId,
  sprint,
  close,
}: {
  projectId: string;
  sprint: Sprint & { issueCount: number };
  close: () => void;
}) {
  const today = isoDay(new Date());
  const [name, setName] = useState(sprint.name);
  const [goal, setGoal] = useState(sprint.goal ?? "");
  const [start, setStart] = useState(today);
  const [weeks, setWeeks] = useState<number | "custom">(2);
  const [customEnd, setCustomEnd] = useState(isoDay(addDays(new Date(), 14)));
  const end = weeks === "custom" ? customEnd : isoDay(addDays(new Date(`${start}T00:00:00`), weeks * 7));
  const refresh = useRefreshSprints(projectId);

  const mutation = useMutation({
    mutationFn: () =>
      startSprint(sprint.id, {
        name: name.trim(),
        goal: goal.trim() || null,
        startDate: start === today ? undefined : fromDay(start),
        endDate: fromDay(end),
      }),
    onSuccess: (started) => {
      refresh();
      close();
      toast.success(`${started.name} started`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim()) mutation.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>Start sprint</DialogTitle>
        <DialogDescription>
          {sprint.issueCount} {sprint.issueCount === 1 ? "issue" : "issues"} will be in this sprint. The board shows
          them until you complete it.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sprint-name">Name</Label>
        <Input id="sprint-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sprint-goal">Goal (optional)</Label>
        <Textarea
          id="sprint-goal"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          maxLength={500}
          rows={2}
          placeholder="What should be true when this sprint ends?"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sprint-start">Start</Label>
          <Input id="sprint-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sprint-end">End</Label>
          <Input
            id="sprint-end"
            type="date"
            value={end}
            min={start}
            onChange={(e) => {
              setWeeks("custom");
              setCustomEnd(e.target.value);
            }}
          />
        </div>
      </div>
      <div role="group" aria-label="Duration" className="flex flex-wrap gap-1.5">
        {DURATIONS.map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => setWeeks(w)}
            aria-pressed={weeks === w}
            className={cn(
              "h-7 rounded-md border px-2.5 text-xs font-medium",
              weeks === w ? "border-primary bg-primary-soft text-foreground" : "text-muted-foreground hover:bg-accent",
            )}
          >
            {w} {w === 1 ? "week" : "weeks"}
          </button>
        ))}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" loading={mutation.isPending} disabled={!name.trim() || end <= start}>
          Start sprint
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Complete the active sprint and choose where its open issues go. */
export function CompleteSprintDialog({
  projectId,
  sprint,
  onOpenChange,
}: {
  projectId: string;
  sprint: { id: string; name: string } | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={sprint !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {sprint ? (
          <CompleteSprintForm key={sprint.id} projectId={projectId} sprint={sprint} close={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CompleteSprintForm({
  projectId,
  sprint,
  close,
}: {
  projectId: string;
  sprint: { id: string; name: string };
  close: () => void;
}) {
  const sprints = useQuery({ queryKey: sprintKeys.list(projectId), queryFn: () => fetchSprints(projectId) });
  const current = sprints.data?.find((s) => s.id === sprint.id);
  const planned = (sprints.data ?? []).filter((s) => s.state === "PLANNED");
  const [choice, setChoice] = useState<string | null>(null);
  const target = choice ?? planned[0]?.id ?? "new";
  const refresh = useRefreshSprints(projectId);
  const open = current ? current.totals.issues - current.totals.doneIssues : 0;

  const mutation = useMutation({
    mutationFn: () => completeSprint(sprint.id, open > 0 ? target : "backlog"),
    onSuccess: (result) => {
      refresh();
      close();
      toast.success(
        result.moved
          ? `${result.sprint.name} completed. ${result.moved} open ${result.moved === 1 ? "issue" : "issues"} moved to ${result.movedTo?.name ?? "the backlog"}.`
          : `${result.sprint.name} completed.`,
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const options = [
    ...planned.map((s) => ({ value: s.id, label: s.name })),
    { value: "new", label: "A new sprint" },
    { value: "backlog", label: "The backlog" },
  ];

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>Complete {sprint.name}</DialogTitle>
        <DialogDescription>
          {current
            ? `${current.totals.doneIssues} done, ${open} open. Done issues stay in the sprint.`
            : "Loading the sprint…"}
        </DialogDescription>
      </DialogHeader>
      {open > 0 ? (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-sm font-medium">
            Move {open} open {open === 1 ? "issue" : "issues"} to
          </legend>
          {options.map((option) => (
            <label key={option.value} className="flex h-8 items-center gap-2 rounded-md px-2 text-sm hover:bg-accent/60">
              <input
                type="radio"
                name="move-open-to"
                value={option.value}
                checked={target === option.value}
                onChange={() => setChoice(option.value)}
                className="accent-primary"
              />
              {option.label}
            </label>
          ))}
        </fieldset>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" loading={mutation.isPending} disabled={!current}>
          Complete sprint
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Rename a sprint or change its goal (and, once active, its end date). */
export function EditSprintDialog({
  projectId,
  sprint,
  onOpenChange,
}: {
  projectId: string;
  sprint: Sprint | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={sprint !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {sprint ? <EditSprintForm key={sprint.id} projectId={projectId} sprint={sprint} close={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function EditSprintForm({ projectId, sprint, close }: { projectId: string; sprint: Sprint; close: () => void }) {
  const [name, setName] = useState(sprint.name);
  const [goal, setGoal] = useState(sprint.goal ?? "");
  const [end, setEnd] = useState(sprint.endDate ? sprint.endDate.slice(0, 10) : "");
  const refresh = useRefreshSprints(projectId);
  const mutation = useMutation({
    mutationFn: () =>
      updateSprint(sprint.id, {
        name: name.trim(),
        goal: goal.trim() || null,
        ...(sprint.state === "ACTIVE" && end ? { endDate: fromDay(end) } : {}),
      }),
    onSuccess: () => {
      refresh();
      close();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim()) mutation.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>Edit sprint</DialogTitle>
        <DialogDescription>Its issues stay as they are.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="edit-sprint-name">Name</Label>
        <Input id="edit-sprint-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="edit-sprint-goal">Goal</Label>
        <Textarea id="edit-sprint-goal" value={goal} onChange={(e) => setGoal(e.target.value)} maxLength={500} rows={2} />
      </div>
      {sprint.state === "ACTIVE" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-sprint-end">End date</Label>
          <Input
            id="edit-sprint-end"
            type="date"
            value={end}
            min={sprint.startDate?.slice(0, 10)}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" loading={mutation.isPending} disabled={!name.trim()}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}
