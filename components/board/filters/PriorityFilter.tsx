"use client";

import { ChevronDown } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Priority } from "@/lib/api/projects";
import { PRIORITIES, PRIORITY_DOT_CLASS, PRIORITY_LABEL } from "@/lib/task-meta";
import { cn } from "@/lib/utils";

/**
 * PriorityFilter — multi-select of task priorities (OR within the type).
 * Built on the dropdown-menu checkbox-item pattern (no new dependency).
 */
export function PriorityFilter({
  selected,
  onToggle,
}: {
  selected: Priority[];
  onToggle: (priority: Priority) => void;
}) {
  const count = selected.length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(count > 0 && "border-foreground/30")}
        >
          Priority
          {count > 0 ? (
            <Badge variant="secondary" className="ml-0.5 px-1.5">
              {count}
            </Badge>
          ) : null}
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        {PRIORITIES.map((priority) => (
          <DropdownMenuCheckboxItem
            key={priority}
            checked={selected.includes(priority)}
            // Keep the menu open while toggling several priorities.
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={() => onToggle(priority)}
          >
            <span
              className={cn(
                "size-2 rounded-full",
                PRIORITY_DOT_CLASS[priority],
              )}
            />
            {PRIORITY_LABEL[priority]}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
