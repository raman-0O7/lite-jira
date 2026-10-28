import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Loading placeholders shaped like the screens they stand in for, so content
 * lands where the skeleton was (docs/features/14-loading-states.md). Each group
 * is announced once to screen readers through `Loading`; the blocks are silent.
 */

/** A labelled live region around skeleton blocks. */
export function Loading({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-live="polite" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** A spinner and a short label, for small spots such as menus and pickers. */
export function InlineLoading({ label, className }: { label: string; className?: string }) {
  return (
    <span role="status" className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)}>
      <Spinner className="size-3.5" aria-hidden />
      {label}
    </span>
  );
}

// Varied widths read as text rather than as a grid of bars.
const WIDTHS = ["w-40", "w-28", "w-52", "w-36", "w-44", "w-32"];
const width = (i: number) => WIDTHS[i % WIDTHS.length];

/** The 48px page toolbar with a title placeholder. */
export function PageHeaderSkeleton({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b pr-3 pl-3 md:pl-5">
      {children ?? <Skeleton className="h-4 w-24" />}
    </div>
  );
}

/** Rows of the Projects page. */
export function ProjectRowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <Loading label="Loading projects">
      <ul>
        {Array.from({ length: rows }, (_, i) => (
          <li key={i} className="flex h-12 items-center gap-3 border-b px-4 md:px-5">
            <Skeleton className="size-5 rounded-[5px]" />
            <Skeleton className={cn("h-3.5", width(i))} />
            <Skeleton className="h-3 w-10" />
            <Skeleton className="ml-auto hidden h-3 w-14 sm:block" />
            <Skeleton className="hidden h-3 w-20 md:block" />
          </li>
        ))}
      </ul>
    </Loading>
  );
}

/** The whole Projects page: toolbar and rows. */
export function ProjectListSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeaderSkeleton />
      <ProjectRowsSkeleton />
    </div>
  );
}

// Cards per column, so the board doesn't look like a table.
const CARDS = [3, 2, 1, 2];

/** A project: toolbar, filter bar, and the board's columns or the list's rows. */
export function ProjectSkeleton({ view = "board" }: { view?: "board" | "list" }) {
  return (
    <Loading label="Loading project" className="flex min-h-0 flex-1 flex-col">
      <PageHeaderSkeleton>
        <Skeleton className="size-5 rounded-[5px]" />
        <Skeleton className="h-4 w-28" />
        <Skeleton className="ml-1 h-7 w-[124px]" />
      </PageHeaderSkeleton>
      <div className="flex min-h-10 shrink-0 items-center gap-1.5 border-b px-3 py-1.5 md:px-4">
        <Skeleton className="h-6 w-44" />
        <Skeleton className="h-6 w-16" />
        <Skeleton className="h-6 w-16" />
      </div>
      {view === "list" ? <ListRowsSkeleton /> : null}
      <div className={cn("min-h-0 flex-1 overflow-hidden px-4 pt-3 md:px-5", view === "list" && "hidden")}>
        <div className="flex h-full items-stretch gap-3 px-3.5 pt-3.5">
          {CARDS.map((cards, column) => (
            <div key={column} className="flex max-w-[360px] min-w-[256px] flex-1 basis-0 flex-col gap-2">
              <div className="flex h-7 items-center gap-2 px-1">
                <Skeleton className="size-3.5 rounded-full" />
                <Skeleton className={cn("h-3.5", column % 2 ? "w-16" : "w-20")} />
                <Skeleton className="h-3 w-4" />
              </div>
              {Array.from({ length: cards }, (_, card) => (
                <BoardCardSkeleton key={card} wide={(column + card) % 2 === 0} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </Loading>
  );
}

function ListRowsSkeleton() {
  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      {[3, 2].map((rows, group) => (
        <div key={group}>
          <div className="flex h-9 items-center gap-2 border-b px-4 md:px-5">
            <Skeleton className="size-3.5 rounded-full" />
            <Skeleton className="h-3.5 w-20" />
          </div>
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="flex h-9 items-center gap-3 border-b px-4 md:px-5">
              <Skeleton className="size-3.5" />
              <Skeleton className="h-3 w-14" />
              <Skeleton className={cn("h-3.5", width(group * 3 + i))} />
              <Skeleton className="ml-auto size-5 rounded-full" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function BoardCardSkeleton({ wide }: { wide: boolean }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border bg-surface px-[11px] py-2.5 shadow-card">
      <div className="flex items-center gap-1.5">
        <Skeleton className="size-3.5 rounded-[4px]" />
        <Skeleton className="h-3 w-12" />
      </div>
      <Skeleton className={cn("h-3.5", wide ? "w-full" : "w-4/5")} />
      {wide ? <Skeleton className="h-3.5 w-1/2" /> : null}
      <div className="flex items-center gap-1.5">
        <Skeleton className="h-[18px] w-12 rounded-[5px]" />
        <Skeleton className="ml-auto size-5 rounded-full" />
      </div>
    </div>
  );
}

/** Settings-style rows (icon, two lines) in a card. */
export function RowListSkeleton({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <Loading label={label}>
      <ul className="divide-y rounded-lg border bg-surface shadow-card">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="size-8 rounded-full" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className={cn("h-3.5", width(i))} />
              <Skeleton className={cn("h-3", width(i + 3))} />
            </div>
            <Skeleton className="h-7 w-20" />
          </li>
        ))}
      </ul>
    </Loading>
  );
}

/** A card with a few lines, for settings that load as one block. */
export function CardSkeleton({ label, lines = 3 }: { label: string; lines?: number }) {
  return (
    <Loading label={label}>
      <div className="flex flex-col gap-3 rounded-lg border bg-surface p-4 shadow-card">
        <div className="flex items-center gap-3">
          <Skeleton className="size-8 rounded-full" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
        </div>
        {Array.from({ length: lines - 1 }, (_, i) => (
          <Skeleton key={i} className={cn("h-3", i % 2 ? "w-3/5" : "w-4/5")} />
        ))}
      </div>
    </Loading>
  );
}

/** A Settings page: a heading, a line of help, and a list. */
export function SettingsSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3.5 w-full max-w-md" />
      </div>
      <RowListSkeleton label="Loading settings" />
    </div>
  );
}

/** The issue's timeline: a few events and a comment. */
export function ActivitySkeleton() {
  return (
    <Loading label="Loading activity" className="flex flex-col gap-3 py-1">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-2.5">
          <Skeleton className="size-5 rounded-full" />
          <Skeleton className={cn("h-3", width(i + 1))} />
          <Skeleton className="h-3 w-12" />
        </div>
      ))}
      <div className="flex gap-2.5">
        <Skeleton className="size-5 rounded-full" />
        <div className="flex flex-1 flex-col gap-2 rounded-lg border bg-surface p-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      </div>
    </Loading>
  );
}

/** An issue: title and description on the left, properties on the right. */
export function IssueDetailSkeleton() {
  return (
    <Loading
      label="Loading issue"
      className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row"
    >
      <div className="min-w-0 flex-1">
        <div className="mx-auto flex max-w-[760px] flex-col gap-6 px-5 py-5 md:px-8 md:py-6">
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-1.5">
              <Skeleton className="size-3.5 rounded-[4px]" />
              <Skeleton className="h-3 w-14" />
            </div>
            <Skeleton className="h-6 w-3/4" />
          </div>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-11/12" />
            <Skeleton className="h-3.5 w-2/3" />
          </div>
          <div className="flex flex-col gap-2 border-t pt-5">
            <Skeleton className="h-4 w-16" />
            <ActivitySkeletonBlocks />
          </div>
        </div>
      </div>
      <div className="shrink-0 border-t bg-[color-mix(in_srgb,var(--background)_94%,var(--foreground))] px-3 py-4 md:w-[264px] md:border-t-0 md:border-l">
        <div className="flex flex-col gap-0.5">
          {["w-24", "w-20", "w-28", "w-16", "w-24", "w-20"].map((w, i) => (
            <div key={i} className="grid min-h-[30px] grid-cols-[88px_minmax(0,1fr)] items-center gap-1">
              <Skeleton className="h-3 w-14" />
              <Skeleton className={cn("h-5", w)} />
            </div>
          ))}
        </div>
      </div>
    </Loading>
  );
}

// The activity rows without their own live region (they sit inside the issue's).
function ActivitySkeletonBlocks() {
  return (
    <div className="flex flex-col gap-3 py-1">
      {[0, 1].map((i) => (
        <div key={i} className="flex items-center gap-2.5">
          <Skeleton className="size-5 rounded-full" />
          <Skeleton className={cn("h-3", width(i + 1))} />
        </div>
      ))}
    </div>
  );
}

/** The full-page issue: toolbar plus the issue. */
export function IssuePageSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeaderSkeleton>
        <Skeleton className="size-5 rounded-[5px]" />
        <Skeleton className="hidden h-4 w-24 sm:block" />
        <Skeleton className="h-4 w-16" />
      </PageHeaderSkeleton>
      <IssueDetailSkeleton />
    </div>
  );
}

/** Sidebar project links. */
export function SidebarProjectsSkeleton() {
  return (
    <li>
      <Loading label="Loading projects" className="flex flex-col gap-px">
        {["w-24", "w-32", "w-20"].map((w) => (
          <span key={w} className="flex h-7 items-center gap-2.5 px-2">
            <Skeleton className="size-4 rounded-[4px]" />
            <Skeleton className={cn("h-3", w)} />
          </span>
        ))}
      </Loading>
    </li>
  );
}

/** The whole app: sidebar and an empty panel, while a workspace loads. */
export function AppShellSkeleton() {
  return (
    <Loading label="Loading workspace" className="flex h-dvh min-h-0 w-full bg-chrome">
      <div className="hidden h-full w-60 shrink-0 flex-col gap-3 px-3 pt-3 pb-2 md:flex">
        <div className="flex h-8 items-center gap-2 px-1">
          <Skeleton className="size-6 rounded-md" />
          <Skeleton className="h-3.5 w-28" />
        </div>
        <Skeleton className="h-7 w-full" />
        <div className="flex flex-col gap-px">
          {["w-20", "w-16"].map((w) => (
            <span key={w} className="flex h-7 items-center gap-2.5 px-2">
              <Skeleton className="size-4 rounded-[4px]" />
              <Skeleton className={cn("h-3", w)} />
            </span>
          ))}
        </div>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background md:my-2 md:mr-2 md:rounded-xl md:border md:shadow-panel">
        <PageHeaderSkeleton />
        <ProjectRowsSkeletonBlocks />
      </div>
    </Loading>
  );
}

function ProjectRowsSkeletonBlocks() {
  return (
    <div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex h-12 items-center gap-3 border-b px-4 md:px-5">
          <Skeleton className="size-5 rounded-[5px]" />
          <Skeleton className={cn("h-3.5", width(i))} />
        </div>
      ))}
    </div>
  );
}

/** A centred spinner, for pages too small to be worth a skeleton. */
export function PageSpinner({ label }: { label: string }) {
  return (
    <div role="status" className="flex flex-1 items-center justify-center p-8 text-muted-foreground">
      <Spinner className="size-5" aria-hidden />
      <span className="sr-only">{label}</span>
    </div>
  );
}
