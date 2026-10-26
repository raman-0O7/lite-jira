"use client";

import { format } from "date-fns";
import { CalendarDays, X } from "lucide-react";
import { useState } from "react";

import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { dueStatus } from "@/lib/task-meta";
import { cn } from "@/lib/utils";

/**
 * DueDatePicker — a properties-rail row that opens a calendar for picking (or
 * clearing) a due date. `value` is an ISO string or null; `onChange` receives
 * the picked day as an ISO string, or null when cleared.
 */
export function DueDatePicker({
  value,
  onChange,
  disabled,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? new Date(value) : undefined;
  const tone = selected ? { overdue: "text-danger", soon: "text-warning", normal: "text-foreground" }[dueStatus(selected)] : "";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="group/due relative flex items-center">
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label={selected ? `Due date: ${format(selected, "PPP")}` : "Set due date"}
            className={cn(
              "flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent disabled:pointer-events-none",
              selected ? tone : "text-muted-foreground",
            )}
          >
            <CalendarDays className="size-3.5 shrink-0 text-icon" />
            {selected ? format(selected, "MMM d, yyyy") : "No due date"}
          </button>
        </PopoverTrigger>
        {selected && !disabled ? (
          <button
            type="button"
            aria-label="Clear due date"
            onClick={() => onChange(null)}
            className="absolute right-1 flex size-6 items-center justify-center rounded text-muted-foreground opacity-0 group-hover/due:opacity-100 hover:text-foreground focus-visible:opacity-100"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selected}
          autoFocus
          onSelect={(day) => {
            onChange(day ? day.toISOString() : null);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
