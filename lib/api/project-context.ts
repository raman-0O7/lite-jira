import { request } from "@/lib/api/http";

/** Project context (docs/features/27-project-context.md). */

export const CONTEXT_KINDS = [
  { id: "DECISION", label: "Decision", plural: "Decisions" },
  { id: "CONSTRAINT", label: "Constraint", plural: "Constraints" },
  { id: "CONVENTION", label: "Convention", plural: "Conventions" },
  { id: "VOCABULARY", label: "Vocabulary", plural: "Vocabulary" },
] as const;
export type ContextKind = (typeof CONTEXT_KINDS)[number]["id"];

export const BRIEF_MAX = 20_000;
export const ENTRY_MAX = 1_000;

export type ContextEntry = {
  id: string;
  kind: ContextKind;
  text: string;
  status: "PROPOSED" | "ACCEPTED" | "REJECTED";
  archived: boolean;
  replacedById: string | null;
  replacesId: string | null;
  source: { issueId: string; key: string; title: string; fromGitHub: boolean } | null;
  sourcePrUrl: string | null;
  proposedBy: { type: "agent" | "user"; id: string; name: string } | null;
  decidedBy: { id: string; name: string } | null;
  decidedAt: string | null;
  runId: string | null;
  createdAt: string;
};

export type Brief = { body: string; version: number; updatedAt: string | null };

export type ProjectContext = {
  project: { id: string; key: string; name: string };
  brief: Brief;
  entries: ContextEntry[];
  counts: { proposed: number; live: number };
};

export type BriefRevision = { version: number; body: string; createdAt: string; editedBy: { id: string; name: string } | null };

export type Overlap = {
  issueId: string;
  key: string;
  title: string;
  repository: string;
  files: string[];
  agent: string | null;
  pullRequest: { number: number; url: string } | null;
};

export const contextKeys = {
  project: (projectId: string) => ["project-context", projectId] as const,
  revisions: (projectId: string) => ["project-context", projectId, "revisions"] as const,
  proposals: (issueId: string) => ["context-proposals", issueId] as const,
  overlaps: (issueId: string) => ["overlaps", issueId] as const,
};

/** Whether an entry is served to agents. */
export const isLive = (entry: ContextEntry) =>
  entry.status === "ACCEPTED" && !entry.archived && !entry.replacedById;

export const fetchProjectContext = (projectId: string) =>
  request<ProjectContext>(`/api/projects/${projectId}/context`, "Couldn't load the project context");

export const saveBrief = (projectId: string, body: string, version: number) =>
  request<{ brief: Brief }>(`/api/projects/${projectId}/context/brief`, "Couldn't save the brief", {
    method: "PUT",
    body: { body, version },
  });

export const fetchBriefRevisions = (projectId: string) =>
  request<{ revisions: BriefRevision[] }>(`/api/projects/${projectId}/context/brief/revisions`, "Couldn't load the history");

export const restoreBrief = (projectId: string, version: number) =>
  request<{ brief: Brief }>(`/api/projects/${projectId}/context/brief/revisions/${version}/restore`, "Couldn't restore that version", {
    method: "POST",
  });

export const draftBriefWithAi = (projectId: string) =>
  request<{ brief: string }>(`/api/projects/${projectId}/context/draft`, "Couldn't draft a brief", { method: "POST" });

export const addContextEntry = (
  projectId: string,
  input: { kind: ContextKind; text: string; issueId?: string; replacesId?: string },
) =>
  request<{ entry: ContextEntry }>(`/api/projects/${projectId}/context/entries`, "Couldn't add the entry", {
    method: "POST",
    body: input,
  });

export const decideContextEntry = (
  entryId: string,
  input: { action: "accept" | "reject" | "archive"; text?: string },
) =>
  request<{ entry: ContextEntry }>(`/api/context-entries/${entryId}`, "Couldn't update the entry", {
    method: "PATCH",
    body: input,
  });

export const fetchIssueProposals = (issueId: string) =>
  request<{ proposals: ContextEntry[] }>(`/api/issues/${issueId}/context-proposals`, "Couldn't load proposals");

export const fetchOverlaps = (issueId: string) =>
  request<{ overlaps: Overlap[] }>(`/api/issues/${issueId}/overlaps`, "Couldn't load overlaps");

export const projectOverlapKeys = (projectId: string) => ["overlaps", "project", projectId] as const;

export const fetchProjectOverlaps = (projectId: string) =>
  request<{ overlaps: Record<string, Overlap[]> }>(`/api/projects/${projectId}/overlaps`, "Couldn't load overlaps");
