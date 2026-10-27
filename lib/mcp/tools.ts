import {
  acceptedContent,
  inputRequired,
  type McpServer,
  type ScopeChallengeHandler,
  type ToolAnnotations,
} from "@modelcontextprotocol/server";
import { z } from "zod";

import { MCP_SCOPES } from "@/lib/mcp/config";
import { byUrgency, issueDetail, issueLine, ok, run } from "@/lib/mcp/format";
import { canWrite, ctxForCall, type McpPrincipal, principalUserId } from "@/lib/mcp/principal";
import {
  projectKeyOf,
  resolveAssignee,
  resolveEpic,
  resolveLabels,
  resolveStatus,
  type Workflow,
} from "@/lib/mcp/resolve";
import { listIssueActivity } from "@/lib/services/activity";
import { addComment, listComments } from "@/lib/services/comments";
import type { Ctx } from "@/lib/services/context";
import { badRequest, forbidden } from "@/lib/services/errors";
import {
  createIssue,
  createSubIssue,
  getIssueByKey,
  moveIssue,
  updateIssue,
} from "@/lib/services/issues";
import { getProfile, listMembers } from "@/lib/services/members";
import { getProjectWorkflow, listProjects } from "@/lib/services/projects";
import { searchIssues } from "@/lib/services/search";
import { listWorkspacesForUser, workspaceSlugForCtx } from "@/lib/services/workspaces";
import { issueTypeEnum, priorityEnum } from "@/lib/validations/issue";

/**
 * The MCP tools (docs/features/10-mcp-server.md). Each one resolves the
 * caller's Ctx for the workspace it names, translates names to ids, and calls
 * the same services the web app uses — so roles, token caps, validation, and
 * activity history all apply unchanged.
 */

// ---------- shared argument schemas ----------

const workspace = z
  .string()
  .optional()
  .describe(
    "Workspace slug (see list_workspaces). Optional with an API token or when you belong to one workspace.",
  );
const issueKey = z.string().min(1).describe('Issue key, e.g. "WEB-42"');
const projectKey = z.string().min(1).describe('Project key, e.g. "WEB"');
const status = z
  .string()
  .min(1)
  .describe('A column name from get_project (e.g. "In Review"), or todo / in_progress / done');
const assignee = z
  .string()
  .nullable()
  .describe('"me", a member\'s email or exact name, or null to unassign');
const labelNames = z.array(z.string().min(1)).max(20);
const dueDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .nullable()
  .describe("YYYY-MM-DD, or null to clear");

const READ: ToolAnnotations = { readOnlyHint: true, openWorldHint: false };
const ADD: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const SET: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const OVERWRITE: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };

// ---------- helpers ----------

/** OAuth callers without kanso:write get a step-up challenge instead of a 403. */
function writeChallenge(principal: McpPrincipal): ScopeChallengeHandler {
  return () => {
    if (principal.kind !== "oauth" || canWrite(principal)) return undefined;
    const scopes = [...new Set([...principal.scopes, MCP_SCOPES.read, MCP_SCOPES.write])];
    return {
      scopes: scopes as [string, ...string[]],
      errorDescription: "This tool changes data and needs the kanso:write scope",
    };
  };
}

async function moveToStatus(ctx: Ctx, issue: { id: string; column: { id: string } }, workflow: Workflow, wanted: string) {
  const column = resolveStatus(workflow, wanted);
  if (column.id === issue.column.id) return;
  // Append to the bottom of the column; the service clamps the position.
  await moveIssue(ctx, { issueId: issue.id, toColumnId: column.id, toPosition: column.issueCount });
}

async function detailByKey(ctx: Ctx, key: string) {
  return issueDetail(await getIssueByKey(ctx, key));
}

const toDate = (value: string | null | undefined) =>
  value === undefined ? undefined : value === null ? null : new Date(`${value}T00:00:00.000Z`);

/** The Ctx for a write tool; a read-only credential gets a plain explanation. */
async function writeCtx(principal: McpPrincipal, workspace?: string) {
  if (!canWrite(principal)) {
    throw forbidden(
      principal.kind === "api_token"
        ? "This API token is read-only. Create a read & write token in Settings → API & MCP to make changes."
        : "This connection is read-only. Reconnect and allow changes (kanso:write).",
    );
  }
  return ctxForCall(principal, workspace);
}

// ---------- registration ----------

export function registerTools(server: McpServer, principal: McpPrincipal) {
  const challenge = writeChallenge(principal);

  // ----- read -----

  server.registerTool(
    "whoami",
    {
      title: "Who am I",
      description: "The signed-in Kanso user, what this connection may do, and their workspaces.",
      annotations: READ,
    },
    () =>
      run(async () => {
        const userId = principalUserId(principal);
        const profile = await getProfile(userId);
        const workspaces = await visibleWorkspaces(principal);
        return ok({
          user: profile,
          connection: {
            type: principal.kind === "oauth" ? "oauth" : "api_token",
            access: canWrite(principal) ? "read_write" : "read_only",
            ...(principal.kind === "api_token" && principal.ctx.limits?.projectIds
              ? { limitedToProjects: true }
              : {}),
          },
          workspaces,
        });
      }),
  );

  server.registerTool(
    "list_workspaces",
    {
      title: "List workspaces",
      description: "Workspaces this connection can use, with your role in each.",
      annotations: READ,
    },
    () => run(async () => ok({ workspaces: await visibleWorkspaces(principal) })),
  );

  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description: "Projects in a workspace that you can see.",
      inputSchema: z.object({ workspace }),
      annotations: READ,
    },
    (args) =>
      run(async () => {
        const ctx = await ctxForCall(principal, args.workspace);
        const projects = await listProjects(ctx);
        return ok({
          projects: projects.map((p) => ({
            key: p.key,
            name: p.name,
            mode: p.mode,
            issueCount: p.issueCount,
          })),
        });
      }),
  );

  server.registerTool(
    "get_project",
    {
      title: "Get project",
      description:
        "A project's workflow — its columns in order with their category (TODO, IN_PROGRESS, DONE) — plus its labels and the workspace members you can assign.",
      inputSchema: z.object({ workspace, project: projectKey }),
      annotations: READ,
    },
    (args) =>
      run(async () => {
        const ctx = await ctxForCall(principal, args.workspace);
        const workflow = await getProjectWorkflow(ctx, args.project);
        const members = await listMembers(ctx);
        return ok({
          key: workflow.key,
          name: workflow.name,
          mode: workflow.mode,
          columns: workflow.columns.map((c) => ({
            name: c.name,
            category: c.category,
            issueCount: c.issueCount,
          })),
          labels: workflow.labels.map((l) => l.name),
          members: members
            .filter((m) => m.role !== "GUEST")
            .map((m) => ({ name: m.name, email: m.email, role: m.role })),
        });
      }),
  );

  server.registerTool(
    "search_issues",
    {
      title: "Search issues",
      description: [
        "Search issues with the Kanso query language. Terms are ANDed; commas OR values.",
        "Terms: assignee:me|none|<email>  type:epic,story,task,bug,subtask  status:todo,in_progress,done",
        "is:open|done  priority:low,medium,high,urgent  label:<name>  project:<KEY>  epic:<KEY-1>",
        'parent:<KEY-1>  due:overdue|today|week|none  an issue key  "quoted text"  plain words.',
        'Example: assignee:me is:open type:bug label:auth "login"',
      ].join("\n"),
      inputSchema: z.object({
        workspace,
        query: z.string().max(500).describe("Query, e.g. assignee:me is:open"),
        limit: z.number().int().min(1).max(50).optional().describe("At most 50 (default 25)"),
      }),
      annotations: READ,
    },
    (args) =>
      run(async () => {
        const ctx = await ctxForCall(principal, args.workspace);
        const issues = await searchIssues(ctx, args.query, { limit: args.limit ?? 25 });
        return ok({ count: issues.length, issues: issues.map(issueLine) });
      }),
  );

  server.registerTool(
    "get_issue",
    {
      title: "Get issue",
      description: "One issue with its description, acceptance criteria, sub-issues, comments, and recent history.",
      inputSchema: z.object({ workspace, key: issueKey }),
      annotations: READ,
    },
    (args) =>
      run(async () => {
        const ctx = await ctxForCall(principal, args.workspace);
        const issue = await getIssueByKey(ctx, args.key);
        const [comments, activity] = await Promise.all([
          listComments(ctx, issue.id),
          listIssueActivity(ctx, issue.id),
        ]);
        return ok({
          ...issueDetail(issue),
          comments: comments.map((c) => ({
            author: c.author?.name ?? (c.authorAgentId ? "Agent" : "Deleted user"),
            at: c.createdAt.toISOString(),
            body: c.body,
          })),
          recentActivity: activity.entries.slice(-15).map((entry) => ({
            at: entry.createdAt.toISOString(),
            by: entry.actor?.name ?? entry.actorType,
            action: entry.action,
            via: typeof entry.data.via === "string" ? entry.data.via : undefined,
            changed:
              entry.action === "issue.updated" && isRecord(entry.data.changes)
                ? Object.keys(entry.data.changes)
                : undefined,
          })),
        });
      }),
  );

  server.registerTool(
    "get_my_work",
    {
      title: "Get my work",
      description: "Open issues assigned to you, most urgent first.",
      inputSchema: z.object({ workspace }),
      annotations: READ,
    },
    (args) =>
      run(async () => {
        const ctx = await ctxForCall(principal, args.workspace);
        const issues = await searchIssues(ctx, "assignee:me is:open", { limit: 50 });
        return ok({ count: issues.length, issues: issues.sort(byUrgency).map(issueLine) });
      }),
  );

  // ----- write -----

  server.registerTool(
    "create_issue",
    {
      title: "Create issue",
      description:
        "Create an issue in a project. Pass `parent` to create a sub-issue instead. Status, labels, assignee, and epic are given by name.",
      inputSchema: z.object({
        workspace,
        project: projectKey,
        title: z.string().min(1).max(200),
        description: z.string().max(10_000).optional().describe("Markdown"),
        acceptanceCriteria: z.string().max(10_000).optional().describe("Markdown"),
        type: issueTypeEnum.exclude(["SUBTASK"]).optional().describe("Default TASK"),
        priority: priorityEnum.optional().describe("Default MEDIUM"),
        status: status.optional().describe("Default: the first To Do column"),
        assignee: assignee.optional(),
        labels: labelNames.optional().describe("Existing label names"),
        epic: issueKey.optional().describe("Key of an epic in the same project"),
        parent: issueKey.optional().describe("Create a sub-issue of this issue"),
        estimate: z.number().int().min(0).max(100).optional().describe("Story points"),
        dueDate: dueDate.optional(),
      }),
      annotations: ADD,
      scopeChallenge: challenge,
    },
    (args) =>
      run(async () => {
        const ctx = await writeCtx(principal, args.workspace);
        const workflow = await getProjectWorkflow(ctx, args.project);
        // Resolve every name before writing anything.
        const assigneeUserId =
          args.assignee === undefined ? undefined : await resolveAssignee(ctx, args.assignee);
        const labelIds = args.labels ? resolveLabels(workflow, args.labels) : undefined;
        const epicId = args.epic ? await resolveEpic(ctx, args.epic, workflow.key) : undefined;
        const column = args.status
          ? resolveStatus(workflow, args.status)
          : (workflow.columns.find((c) => c.category === "TODO") ?? workflow.columns[0]);
        if (!column) throw badRequest(`${workflow.key} has no columns`);

        let key: string;
        const extras: Record<string, unknown> = {
          labelIds,
          epicId,
          estimate: args.estimate,
          dueDate: toDate(args.dueDate),
          acceptanceCriteria: args.acceptanceCriteria,
        };
        if (args.parent) {
          if (args.type) throw badRequest("Sub-issues are always type SUBTASK; leave out `type`");
          const parent = await getIssueByKey(ctx, args.parent);
          if (parent.project.key !== workflow.key) {
            throw badRequest(`${parent.key} is not in ${workflow.key}`);
          }
          const sub = await createSubIssue(ctx, parent.id, { title: args.title });
          key = sub.key;
          Object.assign(extras, {
            priority: args.priority,
            description: args.description,
            assigneeUserId,
            // Sub-issues follow their parent's epic.
            epicId: undefined,
          });
          if (args.status) {
            await moveToStatus(ctx, { id: sub.id, column: { id: sub.columnId } }, workflow, args.status);
          }
        } else {
          const card = await createIssue(ctx, column.id, {
            title: args.title,
            type: args.type,
            priority: args.priority,
            description: args.description,
            assigneeUserId,
          });
          key = card.key;
        }

        const patch = Object.fromEntries(Object.entries(extras).filter(([, v]) => v !== undefined));
        if (Object.keys(patch).length > 0) {
          const created = await getIssueByKey(ctx, key);
          await updateIssue(ctx, created.id, patch);
        }
        return ok({ created: key, issue: await detailByKey(ctx, key) });
      }),
  );

  server.registerTool(
    "update_issue",
    {
      title: "Update issue",
      description:
        "Change any of an issue's fields. Omitted fields stay as they are; null clears. `labels` replaces all labels; `addLabels` / `removeLabels` adjust them.",
      inputSchema: z.object({
        workspace,
        key: issueKey,
        title: z.string().min(1).max(200).optional(),
        description: z.string().max(10_000).nullable().optional().describe("Markdown"),
        acceptanceCriteria: z.string().max(10_000).nullable().optional().describe("Markdown"),
        type: issueTypeEnum.exclude(["SUBTASK"]).optional(),
        priority: priorityEnum.optional(),
        status: status.optional(),
        assignee: assignee.optional(),
        labels: labelNames.optional(),
        addLabels: labelNames.optional(),
        removeLabels: labelNames.optional(),
        epic: issueKey.nullable().optional().describe("Epic key, or null to remove"),
        estimate: z.number().int().min(0).max(100).nullable().optional(),
        dueDate: dueDate.optional(),
      }),
      annotations: OVERWRITE,
      scopeChallenge: challenge,
    },
    (args) =>
      run(async () => {
        const ctx = await writeCtx(principal, args.workspace);
        const issue = await getIssueByKey(ctx, args.key);
        const workflow = await getProjectWorkflow(ctx, issue.project.key);

        let labelIds: string[] | undefined;
        if (args.labels) labelIds = resolveLabels(workflow, args.labels);
        if (args.addLabels || args.removeLabels) {
          const current = new Set(labelIds ?? issue.labels.map((l) => l.id));
          for (const id of resolveLabels(workflow, args.addLabels ?? [])) current.add(id);
          for (const id of resolveLabels(workflow, args.removeLabels ?? [])) current.delete(id);
          labelIds = [...current];
        }

        const patch = Object.fromEntries(
          Object.entries({
            title: args.title,
            description: args.description,
            acceptanceCriteria: args.acceptanceCriteria,
            type: args.type,
            priority: args.priority,
            estimate: args.estimate,
            dueDate: toDate(args.dueDate),
            labelIds,
            assigneeUserId:
              args.assignee === undefined ? undefined : await resolveAssignee(ctx, args.assignee),
            epicId: args.epic === undefined ? undefined : await resolveEpic(ctx, args.epic, workflow.key),
          }).filter(([, v]) => v !== undefined),
        );
        if (Object.keys(patch).length === 0 && !args.status) {
          throw badRequest("Nothing to change — pass at least one field");
        }
        // Resolve the status before writing, so a bad name changes nothing.
        if (args.status) resolveStatus(workflow, args.status);
        if (Object.keys(patch).length > 0) await updateIssue(ctx, issue.id, patch);
        if (args.status) await moveToStatus(ctx, issue, workflow, args.status);
        return ok({ issue: await detailByKey(ctx, issue.key) });
      }),
  );

  server.registerTool(
    "move_issue",
    {
      title: "Move issue",
      description: "Move an issue to another column (status). It goes to the bottom of that column.",
      inputSchema: z.object({ workspace, key: issueKey, status }),
      annotations: SET,
      scopeChallenge: challenge,
    },
    (args) =>
      run(async () => {
        const ctx = await writeCtx(principal, args.workspace);
        const issue = await getIssueByKey(ctx, args.key);
        const workflow = await getProjectWorkflow(ctx, issue.project.key);
        await moveToStatus(ctx, issue, workflow, args.status);
        const moved = await getIssueByKey(ctx, issue.key);
        return ok({ key: moved.key, status: `${moved.column.name} (${moved.column.category})` });
      }),
  );

  server.registerTool(
    "create_subtasks",
    {
      title: "Create sub-issues",
      description: "Break an issue down: add up to 20 sub-issues under it, in order.",
      inputSchema: z.object({
        workspace,
        key: issueKey.describe("The parent issue (not an epic or a sub-issue)"),
        titles: z.array(z.string().min(1).max(200)).min(1).max(20),
      }),
      annotations: ADD,
      scopeChallenge: challenge,
    },
    (args) =>
      run(async () => {
        const ctx = await writeCtx(principal, args.workspace);
        const parent = await getIssueByKey(ctx, args.key);
        const created: string[] = [];
        for (const title of args.titles) {
          created.push((await createSubIssue(ctx, parent.id, { title })).key);
        }
        return ok({ parent: parent.key, created });
      }),
  );

  server.registerTool(
    "assign_issue",
    {
      title: "Assign issue",
      description: "Assign an issue to a workspace member (not a guest), to yourself with \"me\", or unassign with null.",
      inputSchema: z.object({ workspace, key: issueKey, assignee }),
      annotations: SET,
      scopeChallenge: challenge,
    },
    (args) =>
      run(async () => {
        const ctx = await writeCtx(principal, args.workspace);
        const issue = await getIssueByKey(ctx, args.key);
        const assigneeUserId = await resolveAssignee(ctx, args.assignee);
        const updated = await updateIssue(ctx, issue.id, { assigneeUserId });
        return ok({ key: updated.key, assignee: updated.assignee?.name ?? null });
      }),
  );

  server.registerTool(
    "add_comment",
    {
      title: "Add comment",
      description: "Comment on an issue (Markdown). Guests can comment too.",
      inputSchema: z.object({ workspace, key: issueKey, body: z.string().min(1).max(10_000) }),
      annotations: ADD,
      scopeChallenge: challenge,
    },
    (args) =>
      run(async () => {
        const ctx = await writeCtx(principal, args.workspace);
        const issue = await getIssueByKey(ctx, args.key);
        const comment = await addComment(ctx, issue.id, { body: args.body });
        return ok({ key: issue.key, commentId: comment.id, at: comment.createdAt.toISOString() });
      }),
  );

  const bulkChanges = z
    .object({
      status: status.optional(),
      priority: priorityEnum.optional(),
      assignee: assignee.optional(),
      addLabels: labelNames.optional(),
      removeLabels: labelNames.optional(),
    })
    .refine((c) => Object.values(c).some((v) => v !== undefined), "Pass at least one change");
  const confirmation = z.object({
    confirm: z.boolean().describe("Apply these changes"),
  });

  server.registerTool(
    "bulk_update_issues",
    {
      title: "Bulk update issues",
      description:
        "Apply the same change to up to 50 issues of one project: status, priority, assignee, or labels. Asks you to confirm first when the client supports it.",
      inputSchema: z.object({
        workspace,
        keys: z.array(issueKey).min(1).max(50),
        changes: bulkChanges,
      }),
      annotations: OVERWRITE,
      scopeChallenge: challenge,
    },
    (args, extra) =>
      run(async () => {
        const ctx = await writeCtx(principal, args.workspace);
        const keys = [...new Set(args.keys.map((k) => k.trim().toUpperCase()))];
        const projectKeys = new Set(keys.map(projectKeyOf));
        if (projectKeys.size > 1) throw badRequest("All issues must be in the same project");
        const workflow = await getProjectWorkflow(ctx, [...projectKeys][0]!);
        const { changes } = args;

        // Resolve names up front; a typo fails before anything changes.
        if (changes.status) resolveStatus(workflow, changes.status);
        const addIds = resolveLabels(workflow, changes.addLabels ?? []);
        const removeIds = resolveLabels(workflow, changes.removeLabels ?? []);
        const assigneeUserId =
          changes.assignee === undefined ? undefined : await resolveAssignee(ctx, changes.assignee);

        // Ask for confirmation through elicitation when the client offers it.
        if (server.server.getClientCapabilities()?.elicitation) {
          const answer = acceptedContent(extra.mcpReq.inputResponses, "confirm", confirmation);
          if (answer === undefined) {
            return inputRequired({
              inputRequests: {
                confirm: inputRequired.elicit({
                  message: `Update ${keys.length} issue${keys.length === 1 ? "" : "s"} in ${workflow.key} (${keys.join(", ")}): ${describeChanges(changes)}?`,
                  requestedSchema: confirmation,
                }),
              },
            });
          }
          if (!answer.confirm) return ok({ updated: [], cancelled: true });
        }

        const results: { key: string; ok: boolean; error?: string }[] = [];
        for (const key of keys) {
          try {
            const issue = await getIssueByKey(ctx, key);
            const patch: Record<string, unknown> = {};
            if (changes.priority) patch.priority = changes.priority;
            if (assigneeUserId !== undefined) patch.assigneeUserId = assigneeUserId;
            if (addIds.length || removeIds.length) {
              const labels = new Set(issue.labels.map((l) => l.id));
              for (const id of addIds) labels.add(id);
              for (const id of removeIds) labels.delete(id);
              patch.labelIds = [...labels];
            }
            if (Object.keys(patch).length > 0) await updateIssue(ctx, issue.id, patch);
            if (changes.status) await moveToStatus(ctx, issue, await getProjectWorkflow(ctx, workflow.key), changes.status);
            results.push({ key, ok: true });
          } catch (error) {
            results.push({ key, ok: false, error: error instanceof Error ? error.message : "Failed" });
          }
        }
        return ok({
          updated: results.filter((r) => r.ok).map((r) => r.key),
          failed: results.filter((r) => !r.ok),
        });
      }),
  );
}

function describeChanges(changes: {
  status?: string;
  priority?: string;
  assignee?: string | null;
  addLabels?: string[];
  removeLabels?: string[];
}) {
  const parts: string[] = [];
  if (changes.status) parts.push(`status → ${changes.status}`);
  if (changes.priority) parts.push(`priority → ${changes.priority}`);
  if (changes.assignee !== undefined) parts.push(`assignee → ${changes.assignee ?? "nobody"}`);
  if (changes.addLabels?.length) parts.push(`add labels ${changes.addLabels.join(", ")}`);
  if (changes.removeLabels?.length) parts.push(`remove labels ${changes.removeLabels.join(", ")}`);
  return parts.join("; ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Workspaces the principal can use: an API token's own, or all of an OAuth user's. */
async function visibleWorkspaces(principal: McpPrincipal) {
  const all = await listWorkspacesForUser(principalUserId(principal));
  const slug = principal.kind === "api_token" ? await workspaceSlugForCtx(principal.ctx) : null;
  return all
    .filter((w) => slug === null || w.slug === slug)
    .map((w) => ({ slug: w.slug, name: w.name, role: w.role, personal: w.personal }));
}
