"use client";

import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * TextFilter — free-text search input (matches title + description).
 *
 * Controlled by the live text draft from `useBoardFilters`; the hook debounces
 * the value into the URL. A clear (X) button appears once there's text.
 */
export function TextFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative w-full sm:w-64">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search tasks…"
        aria-label="Search tasks"
        className="pl-8 pr-8 [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className="absolute right-1 top-1/2 size-6 -translate-y-1/2 text-muted-foreground"
        >
          <X />
        </Button>
      ) : null}
    </div>
  );
}
