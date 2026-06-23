"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, Tag } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { LabelChip } from "@/components/board/LabelChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { LabelStub } from "@/lib/api/boards";
import {
  createLabel,
  fetchBoardLabels,
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
 * LabelPicker — assign/unassign board labels on a task, and create new ones.
 *
 * `selectedIds` is the task's current label set; `onChange` receives the next
 * set when the user toggles a label. Board labels are fetched + cached under
 * `labelKeys.board`. Creating a label appends to that cache and auto-assigns it.
 */
export function LabelPicker({
  boardId,
  selectedIds,
  onChange,
  disabled,
}: {
  boardId: string;
  selectedIds: string[];
  onChange: (nextIds: string[]) => void;
  disabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PALETTE[0]);

  const labelsQuery = useQuery({
    queryKey: labelKeys.board(boardId),
    queryFn: () => fetchBoardLabels(boardId),
    enabled: open,
  });

  const create = useMutation({
    mutationFn: () => createLabel(boardId, { name: newName.trim(), color: newColor }),
    onSuccess: (label) => {
      queryClient.setQueryData<LabelStub[]>(labelKeys.board(boardId), (prev) =>
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
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          <Tag />
          Labels
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 gap-1.5">
        {labelsQuery.isPending ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">Loading…</p>
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
                  className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-accent"
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

        <div className="-mx-2.5 my-0.5 border-t" />

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
                disabled={create.isPending}
              >
                {create.isPending ? "Creating…" : "Create"}
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
