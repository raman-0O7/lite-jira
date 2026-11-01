import { request } from "@/lib/api/http";
import type { IssueSearchResult } from "@/lib/api/issues";

/** Client for My Work, saved filters and issue links (docs/features/22-my-work.md). */

export type MyWork = {
  needsYou: IssueSearchResult[];
  inProgress: IssueSearchResult[];
  todo: IssueSearchResult[];
  doneThisWeek: IssueSearchResult[];
  created: IssueSearchResult[];
};

export type SavedFilter = {
  id: string;
  name: string;
  query: string;
  shared: boolean;
  createdAt: string;
  updatedAt: string;
  owner: { id: string; name: string; image: string | null };
};

export type LinkRelation = "blocks" | "blocked_by" | "relates" | "duplicates" | "duplicated_by";

export type IssueLink = {
  id: string;
  relation: LinkRelation;
  issue: {
    id: string;
    key: string;
    number: number;
    title: string;
    type: IssueSearchResult["type"];
    column: { name: string; category: "TODO" | "IN_PROGRESS" | "DONE" };
  };
};

export const RELATION_LABEL: Record<LinkRelation, string> = {
  blocks: "Blocks",
  blocked_by: "Blocked by",
  relates: "Relates to",
  duplicates: "Duplicates",
  duplicated_by: "Duplicated by",
};

export const workKeys = {
  myWork: (slug: string) => ["my-work", slug] as const,
  search: (slug: string, query: string) => ["issue-search", slug, query] as const,
  filters: (slug: string) => ["saved-filters", slug] as const,
  filter: (slug: string, id: string) => ["saved-filters", slug, id] as const,
  links: (issueId: string) => ["issue-links", issueId] as const,
};

export const fetchMyWork = (slug: string) => request<MyWork>(`/api/workspaces/${slug}/my-work`, "Failed to load your work");

const filtersBase = (slug: string) => `/api/workspaces/${slug}/filters`;

export const fetchSavedFilters = (slug: string) =>
  request<{ filters: SavedFilter[] }>(filtersBase(slug), "Failed to load filters").then((d) => d.filters);

export const fetchSavedFilter = (slug: string, id: string) =>
  request<{ filter: SavedFilter }>(`${filtersBase(slug)}/${id}`, "Filter not found").then((d) => d.filter);

export const createSavedFilter = (slug: string, body: { name: string; query: string; shared: boolean }) =>
  request<{ filter: SavedFilter }>(filtersBase(slug), "Couldn’t save the filter", { method: "POST", body }).then(
    (d) => d.filter,
  );

export const updateSavedFilter = (slug: string, id: string, body: Partial<Pick<SavedFilter, "name" | "query" | "shared">>) =>
  request<{ filter: SavedFilter }>(`${filtersBase(slug)}/${id}`, "Couldn’t update the filter", {
    method: "PATCH",
    body,
  }).then((d) => d.filter);

export const deleteSavedFilter = (slug: string, id: string) =>
  request(`${filtersBase(slug)}/${id}`, "Couldn’t delete the filter", { method: "DELETE" });

export const fetchIssueLinks = (issueId: string) =>
  request<{ links: IssueLink[] }>(`/api/issues/${issueId}/links`, "Failed to load links").then((d) => d.links);

export const addIssueLink = (issueId: string, body: { relation: LinkRelation; target: string }) =>
  request<{ link: IssueLink }>(`/api/issues/${issueId}/links`, "Couldn’t link the issue", { method: "POST", body }).then(
    (d) => d.link,
  );

export const removeIssueLink = (issueId: string, linkId: string) =>
  request(`/api/issues/${issueId}/links/${linkId}`, "Couldn’t remove the link", { method: "DELETE" });
