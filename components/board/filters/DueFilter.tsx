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
import {
  DUE_FILTERS,
  DUE_FILTER_LABEL,
  type DueFilter as DueFilterValue,
} from "@/lib/board-filters";
import { cn } from "@/lib/utils";

/**
 * DueFilter — multi-select of due-date quick filters (Overdue · Due this week ·
 * No due date), OR-combined within the type.
 */
export function DueFilter({
  selected,
  onToggle,
}: {
  selected: DueFilterValue[];
  onToggle: (due: DueFilterValue) => void;
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
          Due
          {count > 0 ? (
            <Badge variant="secondary" className="ml-0.5 px-1.5">
              {count}
            </Badge>
          ) : null}
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        {DUE_FILTERS.map((due) => (
          <DropdownMenuCheckboxItem
            key={due}
            checked={selected.includes(due)}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={() => onToggle(due)}
          >
            {DUE_FILTER_LABEL[due]}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
