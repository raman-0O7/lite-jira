import { type McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { z } from "zod";

import { ctxForCall, type McpPrincipal } from "@/lib/mcp/principal";
import { getIssueByKey } from "@/lib/services/issues";
import { getProjectWorkflow } from "@/lib/services/projects";

/**
 * Resources and prompts. Resource URIs carry the workspace slug because
 * issue and project keys are only unique within a workspace.
 */

const CATEGORY_MEANING = {
  TODO: "not started",
  IN_PROGRESS: "being worked on",
  DONE: "finished — moving an issue here completes it",
} as const;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

function issueMarkdown(issue: Awaited<ReturnType<typeof getIssueByKey>>) {
  const lines = [
    `# ${issue.key}: ${issue.title}`,
    "",
    `- Type: ${issue.type}`,
    `- Status: ${issue.column.name} (${issue.column.category})`,
    `- Priority: ${issue.priority}`,
    `- Assignee: ${issue.assignee?.name ?? "Unassigned"}`,
    issue.labels.length ? `- Labels: ${issue.labels.map((l) => l.name).join(", ")}` : null,
    issue.epic ? `- Epic: ${issue.epic.key} ${issue.epic.title}` : null,
    issue.parent ? `- Parent: ${issue.parent.key} ${issue.parent.title}` : null,
    issue.estimate !== null ? `- Estimate: ${issue.estimate}` : null,
    issue.dueDate ? `- Due: ${issue.dueDate.toISOString().slice(0, 10)}` : null,
    "",
    "## Description",
    "",
    issue.description || "_No description._",
  ];
  if (issue.acceptanceCriteria) lines.push("", "## Acceptance criteria", "", issue.acceptanceCriteria);
  if (issue.subIssues.length) {
    lines.push("", "## Sub-issues", "");
    for (const s of issue.subIssues) lines.push(`- [${s.done ? "x" : " "}] ${s.key} ${s.title}`);
  }
  return lines.filter((line) => line !== null).join("\n");
}

export function registerResources(server: McpServer, principal: McpPrincipal) {
  server.registerResource(
    "issue",
    new ResourceTemplate("issue://{workspace}/{key}", { list: undefined }),
    {
      title: "Issue",
      description: "An issue as Markdown, e.g. issue://acme/WEB-42",
      mimeType: "text/markdown",
    },
    async (uri, variables) => {
      const ctx = await ctxForCall(principal, one(variables.workspace));
      const issue = await getIssueByKey(ctx, one(variables.key));
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: issueMarkdown(issue) }] };
    },
  );

  server.registerResource(
    "project-workflow",
    new ResourceTemplate("project://{workspace}/{key}/workflow", { list: undefined }),
    {
      title: "Project workflow",
      description: "A project's columns in order and what each category means, e.g. project://acme/WEB/workflow",
      mimeType: "text/markdown",
    },
    async (uri, variables) => {
      const ctx = await ctxForCall(principal, one(variables.workspace));
      const workflow = await getProjectWorkflow(ctx, one(variables.key));
      const text = [
        `# ${workflow.name} (${workflow.key}) workflow`,
        "",
        "Issues move left to right through these columns:",
        "",
        ...workflow.columns.map(
          (c, i) => `${i + 1}. **${c.name}** — ${c.category}: ${CATEGORY_MEANING[c.category]} (${c.issueCount} issues)`,
        ),
        "",
        workflow.labels.length
          ? `Labels: ${workflow.labels.map((l) => l.name).join(", ")}`
          : "No labels yet.",
      ].join("\n");
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text }] };
    },
  );
}

const user = (text: string) => ({
  messages: [{ role: "user" as const, content: { type: "text" as const, text } }],
});

export function registerPrompts(server: McpServer) {
  server.registerPrompt(
    "break_down_epic",
    {
      title: "Break down an epic",
      description: "Plan the stories and tasks for an epic, then create them.",
      argsSchema: z.object({ key: z.string().describe('Epic key, e.g. "WEB-12"') }),
    },
    ({ key }) =>
      user(
        `Read ${key} with get_issue and the project's workflow with get_project. Propose a breakdown into ` +
          `stories and tasks (each with a one-line goal and acceptance criteria), ordered so each step is ` +
          `shippable. Show me the plan first. After I approve, create each issue with create_issue, ` +
          `setting epic to ${key}.`,
      ),
  );

  server.registerPrompt(
    "plan_sprint",
    {
      title: "Plan a sprint",
      description: "Suggest what to take on next from a project's open work.",
      argsSchema: z.object({
        project: z.string().describe('Project key, e.g. "WEB"'),
        capacity: z.string().optional().describe("Points or days available, if known"),
      }),
    },
    ({ project, capacity }) =>
      user(
        `Look at the open issues in ${project} (search_issues with "project:${project} is:open") and its ` +
          `workflow (get_project). Suggest a focused set of issues for the next sprint` +
          (capacity ? ` within ${capacity}` : "") +
          `: prioritize urgent and overdue work, respect parent/epic order, and flag issues that need ` +
          `more detail or an estimate. Don't change anything until I confirm.`,
      ),
  );

  server.registerPrompt(
    "write_standup",
    {
      title: "Write my standup",
      description: "Summarize what you did, what's next, and blockers from your Kanso issues.",
    },
    () =>
      user(
        `Use get_my_work for my open issues, and search_issues with "assignee:me is:done" for recently ` +
          `finished ones (check get_issue history for what changed lately). Write a short standup: ` +
          `Yesterday, Today, Blockers. Mention issue keys.`,
      ),
  );
}
