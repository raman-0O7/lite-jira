import { generateKeyPairSync } from "node:crypto";

import { setGitHubFetch } from "@/lib/github/client";

/**
 * An in-memory GitHub for tests: just enough of the REST API for the app's
 * calls. Configure the app env, then inspect `calls` and mutate `state`.
 */

export const WEBHOOK_SECRET = "test-webhook-secret";

let privateKey: string | null = null;

export function configureGitHubEnv() {
  privateKey ??= generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({
    type: "pkcs1",
    format: "pem",
  }) as string;
  Object.assign(process.env, {
    GITHUB_APP_ID: "12345",
    GITHUB_APP_SLUG: "kanso-test",
    GITHUB_APP_PRIVATE_KEY: privateKey,
    GITHUB_APP_CLIENT_ID: "Iv1.test",
    GITHUB_APP_CLIENT_SECRET: "client-secret",
    GITHUB_WEBHOOK_SECRET: WEBHOOK_SECRET,
  });
}

export type FakeIssue = {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  assignees: string[];
  labels?: { name: string; color: string }[];
};

export function fakeGitHub() {
  const state = {
    user: { id: 1001, login: "ana-gh" },
    userInstallations: [77],
    installations: { 77: { login: "acme", type: "Organization" } } as Record<number, { login: string; type: string }>,
    repos: ["acme/web"],
    issues: {} as Record<string, FakeIssue[]>,
    checkSuites: {} as Record<string, { status: string; conclusion: string | null; latest_check_runs_count?: number }[]>,
    failNextPatch: false,
  };
  const calls: { method: string; path: string; body?: unknown; auth?: string }[] = [];

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

  const impl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const auth = new Headers(init?.headers).get("authorization") ?? undefined;
    const path = url.pathname;
    calls.push({ method, path: path + url.search, body, auth });

    if (url.hostname === "github.com" && path === "/login/oauth/access_token") {
      return body?.code === "good-code" ? json({ access_token: "user-token" }) : json({ error_description: "bad code" });
    }
    if (path === "/user") return json(state.user);
    if (path === "/user/installations") return json({ installations: state.userInstallations.map((id) => ({ id })) });

    let m = /^\/app\/installations\/(\d+)(\/access_tokens)?$/.exec(path);
    if (m) {
      const account = state.installations[Number(m[1])];
      if (!account) return json({ message: "Not Found" }, 404);
      return m[2]
        ? json({ token: `inst-${m[1]}`, expires_at: new Date(Date.now() + 3_600_000).toISOString() }, 201)
        : json({ id: Number(m[1]), account });
    }
    if (path === "/installation/repositories") {
      return json({ repositories: state.repos.map((full_name) => ({ full_name, private: false })) });
    }
    m = /^\/repos\/([^/]+\/[^/]+)\/issues$/.exec(path);
    if (m) {
      const assignee = url.searchParams.get("assignee");
      const list = (state.issues[m[1]!] ?? []).filter(
        (i) => i.state === "open" && (!assignee || i.assignees.includes(assignee)),
      );
      return json(
        list.map((i) => ({
          ...i,
          html_url: `https://github.com/${m![1]}/issues/${i.number}`,
          assignees: i.assignees.map((login, n) => ({ id: n + 1, login })),
          labels: i.labels ?? [],
        })),
      );
    }
    m = /^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)$/.exec(path);
    if (m && method === "PATCH") {
      if (state.failNextPatch) {
        state.failNextPatch = false;
        return json({ message: "Server Error" }, 502);
      }
      const issue = state.issues[m[1]!]?.find((i) => i.number === Number(m![2]));
      if (issue) issue.state = body.state;
      return json({ number: Number(m[2]), state: body.state });
    }
    m = /^\/repos\/([^/]+\/[^/]+)\/commits\/([^/]+)\/check-suites$/.exec(path);
    if (m) return json({ check_suites: state.checkSuites[m[2]!] ?? [] });

    return json({ message: `Fake GitHub: no route for ${method} ${path}` }, 404);
  };

  setGitHubFetch(impl);
  return { state, calls };
}

export function resetGitHub() {
  setGitHubFetch(null);
}
