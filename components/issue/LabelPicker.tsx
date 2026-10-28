"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, Tag } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { LabelChip } from "@/components/issue/LabelChip";
import { InlineLoading } from "@/components/loading/skeletons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { LabelStub } from "@/lib/api/projects";
import {
  createLabel,
  fetchProjectLabels,
  labelKeys,
} from "@/lib/api/labels";
import { cn } from "@/lib/utils";
import { readableTextColor } from "@/lib/task-meta";

// A small palette so users can create labels without a full color picker.
const PALETTE = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#6366f1",
  "#a855f7",
  "#ec4899",
  "#64748b",
  "#0ea5e9",
];

/**
 * LabelPicker — assign/unassign project labels on an issue, and create new ones.
 *
 * `selectedIds` is the issue's current label set; `onChange` receives the next
 * set when the user toggles a label. Project labels are fetched + cached under
 * `labelKeys.project`. Creating a label appends to that cache and auto-assigns it.
 */
export function LabelPicker({
  projectId,
  selectedIds,
  onChange,
  disabled,
  trigger,
}: {
  projectId: string;
  selectedIds: string[];
  onChange: (nextIds: string[]) => void;
  disabled?: boolean;
  /** A custom trigger element (gets the popover's props); defaults to an "Add label" button. */
  trigger?: React.ReactElement;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PALETTE[0]);

  const labelsQuery = useQuery({
    queryKey: labelKeys.project(projectId),
    queryFn: () => fetchProjectLabels(projectId),
    enabled: open,
  });

  const create = useMutation({
    mutationFn: () => createLabel(projectId, { name: newName.trim(), color: newColor }),
    onSuccess: (label) => {
      queryClient.setQueryData<LabelStub[]>(labelKeys.project(projectId), (prev) =>
        prev ? [...prev, label] : [label],
      );
      onChange([...selectedIds, label.id]);
      setNewName("");
      setCreating(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const labels = labelsQuery.data ?? [];
  const selected = new Set(selectedIds);

  function toggle(id: string) {
    if (selected.has(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  }

  function submitCreate() {
    if (!newName.trim()) {
      toast.error("Name is required.");
      return;
    }
    create.mutate();
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        {trigger ?? (
          <Button variant="ghost" size="xs" className="text-muted-foreground" disabled={disabled}>
            <Tag />
            Add label
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 gap-1 p-1.5">
        {labelsQuery.isPending ? (
          <InlineLoading label="Loading labels…" className="px-1 py-2" />
        ) : labels.length === 0 ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">
            No labels yet. Create one below.
          </p>
        ) : (
          <div className="flex max-h-48 flex-col gap-0.5 overflow-y-auto">
            {labels.map((label) => {
              const isSelected = selected.has(label.id);
              return (
                <button
                  key={label.id}
                  type="button"
                  onClick={() => toggle(label.id)}
                  className="flex h-7 items-center justify-between gap-2 rounded-md px-1.5 text-left text-sm hover:bg-accent"
                >
                  <LabelChip label={label} />
                  <Check
                    className={cn(
                      "size-4 shrink-0",
                      isSelected ? "opacity-100" : "opacity-0",
                    )}
                  />
                </button>
              );
            })}
          </div>
        )}

        <div className="-mx-1.5 my-0.5 border-t" />

        {creating ? (
          <div className="flex flex-col gap-2">
            <Input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitCreate();
                }
              }}
              placeholder="Label name…"
              maxLength={50}
              autoFocus
              disabled={create.isPending}
            />
            <div className="flex flex-wrap gap-1.5">
              {PALETTE.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`Color ${color}`}
                  onClick={() => setNewColor(color)}
                  style={{ backgroundColor: color }}
                  className={cn(
                    "grid size-5 place-items-center rounded-full ring-offset-2 ring-offset-popover transition-shadow",
                    newColor === color && "ring-2 ring-foreground",
                  )}
                >
                  {newColor === color ? (
                    <Check
                      className="size-3"
                      style={{ color: readableTextColor(color) }}
                    />
                  ) : null}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={submitCreate}
                loading={create.isPending}
                loadingText="Creating…"
              >
                Create
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setCreating(false);
                  setNewName("");
                }}
                disabled={create.isPending}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-muted-foreground"
            onClick={() => setCreating(true)}
          >
            <Plus />
            Create label
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
