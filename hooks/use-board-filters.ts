"use client";

/**
 * use-board-filters (Feature 05) — owns the board's filter state and keeps it in
 * the URL query string so filters are shareable and survive a reload.
 *
 * The URL is the source of truth for the *committed* state. Text input is
 * debounced: the input value updates immediately (so typing feels live) and is
 * flushed to the URL after a short pause, avoiding a history entry per keystroke.
 *
 * Returns the current FilterState plus setters. Filtering itself is pure (see
 * lib/board-filters.ts) and applied by the consumer over already-loaded board
 * data — this hook never touches F03's board/task cache.
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Priority } from "@/lib/api/projects";
import {
  activeFilterCount,
  filtersFromSearchParams,
  filtersToSearchParams,
  isFiltersEmpty,
  type DueFilter,
  type FilterState,
} from "@/lib/board-filters";

const TEXT_DEBOUNCE_MS = 250;

export type UseBoardFilters = {
  /** Committed filter state (derived from the URL + the live text draft). */
  filters: FilterState;
  /** The live (pre-debounce) text value, for binding the input. */
  textDraft: string;
  /** Update the text input; debounced into the URL. */
  setText: (value: string) => void;
  /** Toggle one priority in/out of the selection. */
  togglePriority: (priority: Priority) => void;
  /** Toggle one label id in/out of the selection. */
  toggleLabel: (labelId: string) => void;
  /** Toggle one due quick-filter in/out of the selection. */
  toggleDue: (due: DueFilter) => void;
  /** Reset every filter to empty. */
  clear: () => void;
  /** Number of active filter *types* (for the badge). */
  count: number;
  /** True when nothing is filtering. */
  isEmpty: boolean;
};

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
}

export function useBoardFilters(): UseBoardFilters {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Committed state from the URL. Memoized on the params string so it's stable
  // between unrelated renders.
  const urlFilters = useMemo(
    () => filtersFromSearchParams(searchParams),
    [searchParams],
  );

  // Live text draft: seeded from the URL, then owned locally while typing so the
  // input stays responsive. Kept in sync if the URL text changes externally
  // (e.g. back/forward navigation or a Clear).
  const [textDraft, setTextDraft] = useState(urlFilters.text);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks the last text value WE pushed, so an external URL change (not our own
  // debounced write) can re-seed the draft without clobbering in-flight typing.
  const lastPushedText = useRef(urlFilters.text);

  useEffect(() => {
    if (urlFilters.text !== lastPushedText.current) {
      lastPushedText.current = urlFilters.text;
      setTextDraft(urlFilters.text);
    }
  }, [urlFilters.text]);

  // Push a new FilterState to the URL, preserving unrelated params. Uses replace
  // so filtering doesn't spam the history stack; scroll position is preserved.
  const pushFilters = useCallback(
    (next: FilterState) => {
      // Cancel any pending debounced text write: this push carries the latest
      // text (callers pass the live draft), so a stale timer firing afterwards
      // against an older snapshot would otherwise revert this change.
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      lastPushedText.current = next.text.trim();
      const params = filtersToSearchParams(next, searchParams);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    },
    [pathname, router, searchParams],
  );

  const setText = useCallback(
    (value: string) => {
      setTextDraft(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        pushFilters({ ...urlFilters, text: value });
      }, TEXT_DEBOUNCE_MS);
    },
    [pushFilters, urlFilters],
  );

  // Flush any pending debounced text write on unmount.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const togglePriority = useCallback(
    (priority: Priority) => {
      pushFilters({
        ...urlFilters,
        text: textDraft,
        priorities: toggle(urlFilters.priorities, priority),
      });
    },
    [pushFilters, urlFilters, textDraft],
  );

  const toggleLabel = useCallback(
    (labelId: string) => {
      pushFilters({
        ...urlFilters,
        text: textDraft,
        labelIds: toggle(urlFilters.labelIds, labelId),
      });
    },
    [pushFilters, urlFilters, textDraft],
  );

  const toggleDue = useCallback(
    (due: DueFilter) => {
      pushFilters({
        ...urlFilters,
        text: textDraft,
        due: toggle(urlFilters.due, due),
      });
    },
    [pushFilters, urlFilters, textDraft],
  );

  const clear = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setTextDraft("");
    pushFilters({ text: "", priorities: [], labelIds: [], due: [] });
  }, [pushFilters]);

  // The effective filters used for matching: URL state, but with the live text
  // draft so card visibility updates as you type (before the debounce settles).
  const filters = useMemo<FilterState>(
    () => ({ ...urlFilters, text: textDraft }),
    [urlFilters, textDraft],
  );

  return {
    filters,
    textDraft,
    setText,
    togglePriority,
    toggleLabel,
    toggleDue,
    clear,
    count: activeFilterCount(filters),
    isEmpty: isFiltersEmpty(filters),
  };
}
