"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleHelp, Filter, MoreHorizontal, Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { PageHeader, PageTitle } from "@/components/app-shell/PageHeader";
import { IssueRowsSkeleton } from "@/components/loading/skeletons";
import { useCan, useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { IssueRows } from "@/components/work/IssueRows";
import { searchIssues } from "@/lib/api/issues";
import {
  createSavedFilter,
  deleteSavedFilter,
  fetchSavedFilter,
  type SavedFilter,
  updateSavedFilter,
  workKeys,
} from "@/lib/api/work";
import { useSession } from "@/lib/auth-client";

const SYNTAX: [string, string][] = [
  ["assignee:me", "assigned to you (or none, or an email)"],
  ["is:open · is:done · is:blocked", "state; blocked = an open issue blocks it"],
  ["status:todo,in_progress", "column category"],
  ["type:bug,story", "epic, story, task, bug, subtask"],
  ["priority:high,urgent", "low, medium, high, urgent"],
  ["label:auth", "a label"],
  ["project:WEB", "a project key"],
  ["due:overdue", "overdue, today, week, none"],
  ["epic:WEB-12 · parent:WEB-40", "in an epic / under a parent"],
  ["WEB-42 · “login page”", "a key, or words in the title or description"],
];

/**
 * The issues page (docs/features/22-my-work.md §2): the query language over
 * every project you can see, from `?q=`; `?filter=<id>` loads a saved filter.
 */
export function IssuesView() {
  const { slug } = useWorkspace();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const myId = useSession().data?.user.id;
  const canShare = useCan("filter.share");
  const canModerate = useCan("filter.moderate");

  const filterId = searchParams.get("filter");
  const filter = useQuery({
    queryKey: workKeys.filter(slug, filterId ?? ""),
    queryFn: () => fetchSavedFilter(slug, filterId!),
    enabled: Boolean(filterId),
  });
  // The URL's query wins; a saved filter fills it in when the URL has none.
  const committed = searchParams.get("q") ?? filter.data?.query ?? "";

  const results = useQuery({
    queryKey: workKeys.search(slug, committed),
    queryFn: () => searchIssues(slug, committed),
    enabled: !filterId || filter.isSuccess || Boolean(searchParams.get("q")),
  });

  const mine = filter.data?.owner.id === myId;
  const changed = Boolean(filter.data && committed.trim() !== filter.data.query);
  const [saving, setSaving] = useState<null | "new" | "rename">(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function run(query: string) {
    const params = new URLSearchParams();
    if (filterId) params.set("filter", filterId);
    if (query.trim() && query.trim() !== filter.data?.query) params.set("q", query.trim());
    const next = params.toString();
    router.replace(next ? `${pathname}?${next}` : pathname);
  }

  const refreshFilters = (saved?: SavedFilter) => {
    queryClient.invalidateQueries({ queryKey: workKeys.filters(slug) });
    if (saved) queryClient.setQueryData(workKeys.filter(slug, saved.id), saved);
  };
  const update = useMutation({
    mutationFn: (patch: Partial<Pick<SavedFilter, "name" | "query" | "shared">>) =>
      updateSavedFilter(slug, filterId!, patch),
    onSuccess: (saved) => {
      refreshFilters(saved);
      router.replace(`${pathname}?filter=${saved.id}`);
      toast.success(`Saved “${saved.name}”.`);
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: () => deleteSavedFilter(slug, filterId!),
    onSuccess: () => {
      refreshFilters();
      setConfirmDelete(false);
      router.replace(`${pathname}?q=${encodeURIComponent(committed)}`);
      toast.success("Filter deleted.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const title = filter.data?.name ?? "Issues";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        actions={
          committed.trim() ? (
            <>
              {filter.data && mine && changed ? (
                <Button size="sm" onClick={() => update.mutate({ query: committed })} loading={update.isPending}>
                  Save
                </Button>
              ) : null}
              {!filter.data || changed || !mine ? (
                <Button size="sm" variant={filter.data && mine ? "outline" : "default"} onClick={() => setSaving("new")}>
                  {filter.data ? "Save as new" : "Save filter"}
                </Button>
              ) : null}
              {filter.data && (mine || (filter.data.shared && canModerate)) ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="Filter options">
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {mine ? (
                      <>
                        <DropdownMenuItem onSelect={() => setSaving("rename")}>Rename</DropdownMenuItem>
                        {canShare || filter.data.shared ? (
                          <DropdownMenuItem onSelect={() => update.mutate({ shared: !filter.data!.shared })}>
                            {filter.data.shared ? "Stop sharing" : "Share with the workspace"}
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuSeparator />
                      </>
                    ) : null}
                    <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                      Delete filter
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </>
          ) : null
        }
      >
        {filter.data ? <Filter className="size-4 shrink-0 text-icon" /> : null}
        <PageTitle>{title}</PageTitle>
        {filter.data && !mine ? (
          <span className="truncate text-xs text-muted-foreground">shared by {filter.data.owner.name}</span>
        ) : filter.data?.shared ? (
          <span className="text-xs text-muted-foreground">shared</span>
        ) : null}
      </PageHeader>

      <QueryBar key={committed} committed={committed} onRun={run} error={results.isError ? results.error.message : null} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {filterId && filter.isError ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">{filter.error.message}</p>
        ) : results.isPending ? (
          <IssueRowsSkeleton label="Searching" />
        ) : results.isError ? null : results.data.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">No issues match.</p>
        ) : (
          <IssueRows
            key={committed}
            sections={[
              {
                id: "results",
                title: results.data.length >= 100 ? "First 100 issues" : "Issues",
                hint: "Most recently updated first",
                issues: results.data,
              },
            ]}
          />
        )}
      </div>

      <SaveFilterDialog
        mode={saving}
        onClose={() => setSaving(null)}
        initialName={saving === "rename" ? (filter.data?.name ?? "") : ""}
        initialShared={saving === "rename" ? (filter.data?.shared ?? false) : false}
        canShare={canShare}
        pending={update.isPending}
        onRename={(name) => update.mutate({ name }, { onSuccess: () => setSaving(null) })}
        onCreate={async (name, shared) => {
          const saved = await createSavedFilter(slug, { name, query: committed, shared });
          refreshFilters(saved);
          setSaving(null);
          router.replace(`${pathname}?filter=${saved.id}`);
          toast.success(`Saved “${saved.name}”. It’s in the sidebar.`);
        }}
      />

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{filter.data?.name}”?</DialogTitle>
            <DialogDescription>
              {filter.data?.shared ? "It disappears for everyone it was shared with. " : ""}Issues aren’t affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => remove.mutate()} loading={remove.isPending}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** The query box; remounted (keyed) when the URL's query changes. */
function QueryBar({ committed, onRun, error }: { committed: string; onRun: (query: string) => void; error: string | null }) {
  const [draft, setDraft] = useState(committed);
  return (
    <form
      className="flex shrink-0 items-start gap-2 border-b px-3 py-2 md:px-4"
      onSubmit={(event) => {
        event.preventDefault();
        onRun(draft);
      }}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-icon" />
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="assignee:me is:open priority:high,urgent"
            aria-label="Issue query"
            aria-invalid={error ? true : undefined}
            className="pl-8 font-mono text-[13px]"
            maxLength={1000}
          />
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
      <Button type="submit" size="sm" variant="outline">
        Search
      </Button>
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Query syntax">
            <CircleHelp />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)]">
          <p className="mb-2 text-xs text-muted-foreground">Terms are combined with AND; commas mean OR.</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
            {SYNTAX.map(([term, meaning]) => (
              <div key={term} className="contents">
                <dt className="font-mono text-foreground">{term}</dt>
                <dd className="text-muted-foreground">{meaning}</dd>
              </div>
            ))}
          </dl>
        </PopoverContent>
      </Popover>
    </form>
  );
}

function SaveFilterDialog({
  mode,
  onClose,
  ...form
}: {
  mode: null | "new" | "rename";
  onClose: () => void;
  initialName: string;
  initialShared: boolean;
  canShare: boolean;
  pending: boolean;
  onRename: (name: string) => void;
  onCreate: (name: string, shared: boolean) => Promise<void>;
}) {
  return (
    <Dialog open={mode !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>{mode ? <SaveFilterForm key={mode} mode={mode} onClose={onClose} {...form} /> : null}</DialogContent>
    </Dialog>
  );
}

/** Mounted each time the dialog opens, so it starts from the filter's current name. */
function SaveFilterForm({
  mode,
  onClose,
  initialName,
  initialShared,
  canShare,
  pending,
  onRename,
  onCreate,
}: {
  mode: "new" | "rename";
  onClose: () => void;
  initialName: string;
  initialShared: boolean;
  canShare: boolean;
  pending: boolean;
  onRename: (name: string) => void;
  onCreate: (name: string, shared: boolean) => Promise<void>;
}) {
  const [name, setName] = useState(initialName);
  const [shared, setShared] = useState(initialShared);
  const [creating, setCreating] = useState(false);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!name.trim()) return;
        if (mode === "rename") return onRename(name.trim());
        setCreating(true);
        try {
          await onCreate(name.trim(), shared);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Couldn’t save the filter");
        } finally {
          setCreating(false);
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>{mode === "rename" ? "Rename filter" : "Save filter"}</DialogTitle>
        <DialogDescription>
          {mode === "rename" ? "The query stays the same." : "Saved filters are listed in the sidebar."}
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="filter-name">Name</Label>
        <Input id="filter-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus />
      </div>
      {mode === "new" && canShare ? (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-3.5 accent-primary"
            checked={shared}
            onChange={(e) => setShared(e.target.checked)}
          />
          <span>
            Share with the workspace
            <span className="block text-xs text-muted-foreground">
              Teammates see it in their sidebar. Each person only sees issues they have access to.
            </span>
          </span>
        </label>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!name.trim()} loading={creating || pending}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}
