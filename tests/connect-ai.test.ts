import { describe, expect, it } from "vitest";

import {
  codexCommands,
  cursorInstallLink,
  geminiCommand,
  vscodeCommand,
  vscodeInstallLink,
} from "@/lib/mcp/install-links";
import { knownClient, knownClientForUrl } from "@/lib/mcp/known-clients";

/** docs/features/23-connect-your-ai.md */

const MCP_URL = "https://kanso.example/api/mcp";

describe("knownClient", () => {
  it("recognizes apps by where they receive sign-ins", () => {
    expect(knownClientForUrl("https://chatgpt.com/connector_platform_oauth_redirect")).toBe("chatgpt");
    expect(knownClientForUrl("https://platform.openai.com/apps-manage/oauth")).toBe("chatgpt");
    expect(knownClientForUrl("https://claude.ai/api/mcp/auth_callback")).toBe("claude");
    expect(knownClientForUrl("https://claude.com/oauth/callback")).toBe("claude");
    expect(knownClientForUrl("cursor://anysphere.cursor-retrieval/oauth/user-kanso/callback")).toBe("cursor");
    expect(knownClientForUrl("https://vscode.dev/redirect")).toBe("vscode");
    expect(knownClientForUrl("vscode://vscode.github-authentication/did-authenticate")).toBe("vscode");
  });

  it("doesn't match lookalikes, plain http or loopback", () => {
    expect(knownClientForUrl("https://chatgpt.com.evil.example/cb")).toBeNull();
    expect(knownClientForUrl("https://notchatgpt.com/cb")).toBeNull();
    expect(knownClientForUrl("http://chatgpt.com/cb")).toBeNull();
    expect(knownClientForUrl("http://127.0.0.1:33418/callback")).toBeNull();
    expect(knownClientForUrl("not a url")).toBeNull();
  });

  it("checks the client ID (a metadata document URL) and every redirect URI", () => {
    expect(knownClient({ clientId: "https://claude.ai/oauth/mcp-oauth-client-metadata", redirectUris: [] })).toBe("claude");
    expect(
      knownClient({ clientId: "abc123", redirectUris: ["http://localhost:1/cb", "https://chatgpt.com/connector_platform_oauth_redirect"] }),
    ).toBe("chatgpt");
    expect(knownClient({ clientId: "abc123", redirectUris: ["http://localhost:7777/callback"] })).toBeNull();
  });
});

describe("install links", () => {
  it("builds Codex and Gemini CLI commands", () => {
    expect(codexCommands(MCP_URL)).toEqual({
      add: `codex mcp add kanso --url ${MCP_URL}`,
      login: "codex mcp login kanso",
      config: `[mcp_servers.kanso]\nurl = "${MCP_URL}"`,
    });
    expect(geminiCommand(MCP_URL)).toBe(`gemini mcp add --transport http kanso ${MCP_URL}`);
  });

  it("encodes Cursor's config as base64 of the server object", () => {
    const link = new URL(cursorInstallLink(MCP_URL));
    expect(link.protocol).toBe("cursor:");
    expect(link.searchParams.get("name")).toBe("kanso");
    expect(JSON.parse(atob(link.searchParams.get("config")!))).toEqual({ url: MCP_URL });
  });

  it("builds VS Code's install link and command", () => {
    const link = vscodeInstallLink(MCP_URL);
    expect(link.startsWith("vscode:mcp/install?")).toBe(true);
    expect(JSON.parse(decodeURIComponent(link.slice("vscode:mcp/install?".length)))).toEqual({
      name: "kanso",
      type: "http",
      url: MCP_URL,
    });
    expect(vscodeCommand(MCP_URL)).toBe(`code --add-mcp '{"name":"kanso","type":"http","url":"${MCP_URL}"}'`);
  });
});
