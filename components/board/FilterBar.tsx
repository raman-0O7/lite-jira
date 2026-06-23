"use client";

import { X } from "lucide-react";

import { DueFilter } from "@/components/board/filters/DueFilter";
import { LabelFilter } from "@/components/board/filters/LabelFilter";
import { PriorityFilter } from "@/components/board/filters/PriorityFilter";
import { TextFilter } from "@/components/board/filters/TextFilter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LabelStub } from "@/lib/api/boards";
import type { UseBoardFilters } from "@/hooks/use-board-filters";

/**
 * FilterBar — the search + filter bar above the board (Feature 05).
 *
 * Purely presentational over `useBoardFilters` (state owned by the hook, synced
 * to the URL). Filtering itself is client-side and applied downstream in
 * KanbanBoard; this bar just drives the filter state.
 *
 * `labels` is the board's label set, derived by the caller from the loaded board
 * tasks (so the label multi-select offers exactly the labels in use).
 */
export function FilterBar({
  labels,
  filters,
}: {
  labels: LabelStub[];
  filters: UseBoardFilters;
}) {
  const {
    filters: state,
    textDraft,
    setText,
    togglePriority,
    toggleLabel,
    toggleDue,
    clear,
    count,
  } = filters;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <TextFilter value={textDraft} onChange={setText} />

      <div className="flex flex-wrap items-center gap-2">
        <PriorityFilter
          selected={state.priorities}
          onToggle={togglePriority}
        />
        <LabelFilter
          labels={labels}
          selected={state.labelIds}
          onToggle={toggleLabel}
        />
        <DueFilter selected={state.due} onToggle={toggleDue} />
      </div>

      {count > 0 ? (
        <div className="ml-auto flex items-center gap-2">
          <Badge variant="secondary" aria-label={`${count} active filters`}>
            {count} active
          </Badge>
          <Button variant="ghost" size="sm" onClick={clear}>
            <X />
            Clear filters
          </Button>
        </div>
      ) : null}
    </div>
  );
}
