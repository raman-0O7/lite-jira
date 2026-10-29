/** GitHub App settings from the environment (docs/features/11-github-app.md "Setup"). */
export type GitHubAppConfig = {
  appId: string;
  slug: string;
  privateKey: string;
  clientId: string;
  clientSecret: string;
  webhookSecret: string;
};

export function githubAppConfig(): GitHubAppConfig | null {
  const env = process.env;
  const config = {
    appId: env.GITHUB_APP_ID ?? "",
    slug: env.GITHUB_APP_SLUG ?? "",
    // One line with \n escapes, optionally wrapped in quotes by a pasted .env.
    privateKey: (env.GITHUB_APP_PRIVATE_KEY ?? "")
      .trim()
      .replace(/^"([\s\S]*)"$/, "$1")
      .replace(/\\n/g, "\n"),
    clientId: env.GITHUB_APP_CLIENT_ID ?? "",
    clientSecret: env.GITHUB_APP_CLIENT_SECRET ?? "",
    webhookSecret: env.GITHUB_WEBHOOK_SECRET ?? "",
  };
  return Object.values(config).every(Boolean) ? config : null;
}

export const githubConfigured = () => githubAppConfig() !== null;

export const GITHUB_API = "https://api.github.com";
export const GITHUB_WEB = "https://github.com";
