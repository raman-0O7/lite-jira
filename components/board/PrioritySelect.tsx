"use client";

import type { Priority } from "@/lib/api/boards";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PRIORITIES, PRIORITY_DOT_CLASS, PRIORITY_LABEL } from "@/lib/task-meta";
import { cn } from "@/lib/utils";

/**
 * PrioritySelect — pick a task priority (Low/Med/High/Urgent) with color dots.
 *
 * Controlled: parent owns `value` and persists `onChange`. The modal wires this
 * straight into the task PATCH.
 */
export function PrioritySelect({
  value,
  onChange,
  disabled,
}: {
  value: Priority;
  onChange: (next: Priority) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next as Priority)}
      disabled={disabled}
    >
      <SelectTrigger className="w-full" aria-label="Priority">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PRIORITIES.map((priority) => (
          <SelectItem key={priority} value={priority}>
            <span
              className={cn(
                "size-2 rounded-full",
                PRIORITY_DOT_CLASS[priority],
              )}
            />
            {PRIORITY_LABEL[priority]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
