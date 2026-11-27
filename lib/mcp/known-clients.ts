/**
 * Recognizes the AI apps people connect to Kanso over MCP
 * (docs/features/23-connect-your-ai.md "The page"), so connected apps show
 * "ChatGPT" or "Claude" instead of a raw host.
 *
 * Matching is on where the app sends people back after sign-in (its redirect
 * URIs) and its client ID, never on the name it gives itself: any client can
 * call itself "ChatGPT", but only ChatGPT can receive a code at chatgpt.com.
 * Apps that sign in through a loopback address (CLIs) can't be told apart
 * this way and keep the name they registered with.
 */

export type KnownClient = "chatgpt" | "claude" | "cursor" | "vscode";

export const KNOWN_CLIENT_NAMES: Record<KnownClient, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  cursor: "Cursor",
  vscode: "VS Code",
};

const HOSTS: Record<KnownClient, string[]> = {
  chatgpt: ["chatgpt.com", "openai.com"],
  claude: ["claude.ai", "claude.com"],
  cursor: ["cursor.com", "cursor.sh"],
  vscode: ["vscode.dev"],
};

const SCHEMES: Partial<Record<KnownClient, string[]>> = {
  cursor: ["cursor:"],
  vscode: ["vscode:", "vscode-insiders:"],
};

const underHost = (hostname: string, host: string) => hostname === host || hostname.endsWith(`.${host}`);

/** Which known app a URL belongs to: an https URL on its domain, or its own URL scheme. */
export function knownClientForUrl(raw: string): KnownClient | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  for (const client of Object.keys(HOSTS) as KnownClient[]) {
    if (url.protocol === "https:" && HOSTS[client].some((host) => underHost(url.hostname.toLowerCase(), host))) {
      return client;
    }
    if (SCHEMES[client]?.includes(url.protocol)) return client;
  }
  return null;
}

/**
 * The known app behind an OAuth client: its client ID (a URL for Client ID
 * Metadata Documents) or any of its redirect URIs.
 */
export function knownClient(client: { clientId: string; redirectUris: string[] }): KnownClient | null {
  for (const url of [client.clientId, ...client.redirectUris]) {
    const match = knownClientForUrl(url);
    if (match) return match;
  }
  return null;
}
