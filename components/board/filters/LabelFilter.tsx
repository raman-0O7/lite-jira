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
import type { LabelStub } from "@/lib/api/boards";
import { cn } from "@/lib/utils";

/**
 * LabelFilter — multi-select of the board's labels (OR within the type).
 *
 * The label set is derived by the FilterBar from the loaded board tasks, so this
 * stays purely presentational. Renders nothing when the board has no labels.
 */
export function LabelFilter({
  labels,
  selected,
  onToggle,
}: {
  labels: LabelStub[];
  selected: string[];
  onToggle: (labelId: string) => void;
}) {
  if (labels.length === 0) return null;

  const count = selected.length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(count > 0 && "border-foreground/30")}
        >
          Labels
          {count > 0 ? (
            <Badge variant="secondary" className="ml-0.5 px-1.5">
              {count}
            </Badge>
          ) : null}
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-72 w-52 overflow-y-auto"
      >
        {labels.map((label) => (
          <DropdownMenuCheckboxItem
            key={label.id}
            checked={selected.includes(label.id)}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={() => onToggle(label.id)}
          >
            <span
              className="size-2.5 shrink-0 rounded-full ring-1 ring-foreground/10"
              style={{ backgroundColor: label.color }}
            />
            <span className="truncate">{label.name}</span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
