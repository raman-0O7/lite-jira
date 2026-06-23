"use client";

import { format } from "date-fns";
import { CalendarIcon, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * DueDatePicker — popover + calendar for picking (or clearing) a due date.
 *
 * Controlled: `value` is an ISO date string or null; `onChange` receives the
 * selected day as an ISO string, or `null` when cleared. The modal persists
 * each change via the task PATCH.
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

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-1.5">
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            className={cn(
              "flex-1 justify-start font-normal",
              !selected && "text-muted-foreground",
            )}
          >
            <CalendarIcon />
            {selected ? format(selected, "PPP") : "No due date"}
          </Button>
        </PopoverTrigger>
        {selected ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Clear due date"
            disabled={disabled}
            onClick={() => onChange(null)}
          >
            <X />
          </Button>
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
