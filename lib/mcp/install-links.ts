/**
 * Setup commands and one-click install links for each AI app
 * (docs/features/23-connect-your-ai.md). Formats checked against each
 * vendor's docs in November 2026:
 * - Codex: `codex mcp add <name> --url <url>`, then `codex mcp login <name>`
 * - Gemini CLI: `gemini mcp add --transport http <name> <url>`, then `/mcp auth <name>`
 * - Claude Code: `claude mcp add --transport http <name> <url>`
 * - Cursor: cursor://anysphere.cursor-deeplink/mcp/install?name=…&config=<base64 server JSON>
 * - VS Code: vscode:mcp/install?<url-encoded JSON>, or `code --add-mcp '<JSON>'`
 */

export const SERVER_NAME = "kanso";

/** Single-quote a value for a POSIX shell. */
const shellQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

export function codexCommands(mcpUrl: string) {
  return {
    add: `codex mcp add ${SERVER_NAME} --url ${mcpUrl}`,
    login: `codex mcp login ${SERVER_NAME}`,
    config: `[mcp_servers.${SERVER_NAME}]\nurl = "${mcpUrl}"`,
  };
}

export const geminiCommand = (mcpUrl: string) => `gemini mcp add --transport http ${SERVER_NAME} ${mcpUrl}`;

export const claudeCodeCommand = (mcpUrl: string) => `claude mcp add --transport http ${SERVER_NAME} ${mcpUrl}`;

/** `mcp.json` for Cursor (and other clients that use the same shape). */
export const cursorConfig = (mcpUrl: string) =>
  JSON.stringify({ mcpServers: { [SERVER_NAME]: { url: mcpUrl } } }, null, 2);

/** Cursor's install deeplink: the server object alone, base64-encoded. */
export function cursorInstallLink(mcpUrl: string) {
  const config = btoa(JSON.stringify({ url: mcpUrl }));
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${SERVER_NAME}&config=${encodeURIComponent(config)}`;
}

const vscodeServer = (mcpUrl: string) => ({ name: SERVER_NAME, type: "http", url: mcpUrl });

export const vscodeInstallLink = (mcpUrl: string) =>
  `vscode:mcp/install?${encodeURIComponent(JSON.stringify(vscodeServer(mcpUrl)))}`;

export const vscodeCommand = (mcpUrl: string) => `code --add-mcp ${shellQuote(JSON.stringify(vscodeServer(mcpUrl)))}`;

/** Generic config for MCP clients that take the common `mcpServers` JSON. */
export const genericConfig = (mcpUrl: string) =>
  JSON.stringify({ mcpServers: { [SERVER_NAME]: { type: "http", url: mcpUrl } } }, null, 2);
