import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createMcpHandler } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";

import { MCP_SCOPES } from "@/lib/mcp/config";
import type { McpPrincipal } from "@/lib/mcp/principal";
import { createKansoMcpServer } from "@/lib/mcp/server";
import { compareContracts, type ToolContract, toContracts } from "@/tests/mcp-contract";

/**
 * MCP tool contract (docs/features/23-connect-your-ai.md "Tool contract test").
 *
 * After a compatible change (new tool, new optional input, looser limits), refresh the snapshot:
 *   UPDATE_MCP_CONTRACT=1 pnpm test tests/mcp-contract.test.ts
 * A breaking change also needs ALLOW_BREAKING_MCP_CHANGES=1, and a line in the
 * release notes telling ChatGPT admins to refresh Kanso's tools.
 */

const SNAPSHOT = path.join(import.meta.dirname, "__snapshots__", "mcp-tools.json");

const handler = createMcpHandler(({ authInfo }) => createKansoMcpServer(authInfo!.extra!.principal as McpPrincipal));

async function currentTools() {
  const principal: McpPrincipal = { kind: "oauth", userId: "contract", clientId: "contract", scopes: [MCP_SCOPES.read, MCP_SCOPES.write] };
  const response = await handler.fetch(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-11-25",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    }),
    { authInfo: { token: "t", clientId: "contract", scopes: [], extra: { principal } } },
  );
  const text = await response.text();
  const json = response.headers.get("content-type")?.includes("text/event-stream")
    ? JSON.parse(text.split("\n").filter((l) => l.startsWith("data:")).at(-1)!.slice(5))
    : JSON.parse(text);
  return toContracts(json.result.tools);
}

function readSnapshot(): ToolContract[] | null {
  try {
    return JSON.parse(readFileSync(SNAPSHOT, "utf8")) as ToolContract[];
  } catch {
    return null;
  }
}

describe("MCP tool contract", () => {
  it("matches the published snapshot without breaking changes", async () => {
    const tools = await currentTools();
    const snapshot = readSnapshot();
    const update = process.env.UPDATE_MCP_CONTRACT === "1";

    if (!snapshot) {
      if (!update) throw new Error(`No MCP tool snapshot at ${SNAPSHOT}. Create it with UPDATE_MCP_CONTRACT=1.`);
      writeFileSync(SNAPSHOT, `${JSON.stringify(tools, null, 2)}\n`);
      return;
    }

    const diff = compareContracts(snapshot, tools);
    if (diff.breaking.length && process.env.ALLOW_BREAKING_MCP_CHANGES !== "1") {
      throw new Error(
        [
          "Breaking MCP tool change. ChatGPT keeps a frozen copy of Kanso's tools, so these calls would fail",
          "until each admin refreshes the app (docs/features/23-connect-your-ai.md \"Tool contract test\"):",
          ...diff.breaking.map((line) => `  - ${line}`),
          "Make the change backward compatible (new inputs optional, keep old names and values), or, if it must",
          "break, rerun with UPDATE_MCP_CONTRACT=1 ALLOW_BREAKING_MCP_CHANGES=1 and add it to the release notes.",
        ].join("\n"),
      );
    }
    if (update) {
      writeFileSync(SNAPSHOT, `${JSON.stringify(tools, null, 2)}\n`);
      return;
    }
    expect(
      diff.compatible,
      "MCP tools changed compatibly. Refresh the snapshot: UPDATE_MCP_CONTRACT=1 pnpm test tests/mcp-contract.test.ts",
    ).toEqual([]);
  });
});

describe("compareContracts", () => {
  const tool = (inputSchema: ToolContract["inputSchema"], annotations: ToolContract["annotations"] = {}): ToolContract => ({
    name: "update_issue",
    annotations,
    inputSchema,
  });
  const base = tool(
    {
      type: "object",
      properties: {
        key: { type: "string", maxLength: 20 },
        priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
        labels: { type: "array", items: { type: "string" } },
      },
      required: ["key"],
    },
    { readOnlyHint: false, destructiveHint: false },
  );
  const withSchema = (change: (schema: Record<string, unknown>) => void) => {
    const copy = structuredClone(base);
    change(copy.inputSchema as Record<string, unknown>);
    return copy;
  };
  const props = (schema: Record<string, unknown>) => schema.properties as Record<string, Record<string, unknown>>;

  it("is clean for identical tools", () => {
    expect(compareContracts([base], [structuredClone(base)])).toEqual({ breaking: [], compatible: [] });
  });

  it("allows a new tool and a new optional input", () => {
    const next = withSchema((s) => (props(s).note = { type: "string" }));
    const diff = compareContracts([base], [next, { ...base, name: "get_project_context" }]);
    expect(diff.breaking).toEqual([]);
    expect(diff.compatible).toEqual(["update_issue.note: new optional input", "get_project_context: new tool"]);
  });

  it("allows looser limits and more enum values", () => {
    const next = withSchema((s) => {
      props(s).key.maxLength = 50;
      props(s).priority.enum = ["LOW", "MEDIUM", "HIGH", "URGENT"];
    });
    const diff = compareContracts([base], [next]);
    expect(diff.breaking).toEqual([]);
    expect(diff.compatible).toHaveLength(2);
  });

  it("flags a removed tool", () => {
    expect(compareContracts([base], []).breaking).toEqual(["update_issue: tool removed or renamed"]);
  });

  it("flags a removed input", () => {
    const next = withSchema((s) => delete props(s).labels);
    expect(compareContracts([base], [next]).breaking).toEqual(["update_issue.labels: input removed"]);
  });

  it("flags an optional input made required, and a new required input", () => {
    const next = withSchema((s) => {
      s.required = ["key", "priority", "workspace"];
      props(s).workspace = { type: "string" };
    });
    expect(compareContracts([base], [next]).breaking).toEqual([
      "update_issue.priority: now required",
      "update_issue.workspace: new required input",
    ]);
  });

  it("flags narrowed types, enums and limits", () => {
    const next = withSchema((s) => {
      props(s).key.maxLength = 10;
      props(s).priority.enum = ["LOW", "HIGH"];
      props(s).labels.items = { type: "number" };
    });
    expect(compareContracts([base], [next]).breaking).toEqual([
      "update_issue.key: maxLength lowered to 10",
      'update_issue.priority: no longer accepts "MEDIUM"',
      "update_issue.labels[]: type narrowed from string to number",
    ]);
  });

  it("flags a tool that stops being read-only or becomes destructive", () => {
    const readOnly = { ...base, annotations: { readOnlyHint: true } };
    expect(compareContracts([readOnly], [base]).breaking).toEqual(["update_issue: no longer read-only"]);
    const destructive = { ...base, annotations: { readOnlyHint: false, destructiveHint: true } };
    expect(compareContracts([base], [destructive]).breaking).toEqual(["update_issue: now destructive"]);
  });

  it("ignores descriptions", () => {
    const [plain] = toContracts([{ name: "x", inputSchema: { type: "object", properties: { a: { type: "string" } } } }]);
    const [described] = toContracts([
      { name: "x", inputSchema: { type: "object", description: "d", properties: { a: { type: "string", description: "e" } } } },
    ]);
    expect(compareContracts([plain], [described])).toEqual({ breaking: [], compatible: [] });
  });
});
