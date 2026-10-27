# Feature 10 — MCP server & API tokens

**Wave 8 · depends on 07.** See [`PLAN-v2.md`](../PLAN-v2.md) §1, §3, §6 "10 — MCP server".

## Goal
Let AI agents and tools work in Kanso as the person who connected them. A
remote **MCP server** at `/api/mcp` exposes projects and issues as tools,
resources, and prompts. Clients sign in with **OAuth 2.1** (Claude, Cursor,
VS Code, …) or use a **personal API token**. Every tool goes through the
service layer, so permissions, validation, and activity are the same as on the
web.

## Auth
**OAuth 2.1** — the Better Auth `mcp()` plugin (built on `@better-auth/oauth-provider`)
with the JWT plugin. The deprecated `better-auth/plugins` `mcp` plugin is not used.
- Discovery: `/.well-known/oauth-protected-resource` (RFC 9728) points at the
  authorization server (`/api/auth`, RFC 8414 metadata at
  `/.well-known/oauth-authorization-server/api/auth`).
- Client identity: **Client ID Metadata Documents** (`@better-auth/cimd`, MCP
  2026-07-28 profile). Dynamic Client Registration is also enabled, explicitly,
  for clients that don't support CIMD yet.
- Authorization code + PKCE; refresh tokens with `offline_access`. Access
  tokens are JWTs bound to the resource `${BETTER_AUTH_URL}/api/mcp`, verified
  locally against `/api/auth/jwks`.
- Scopes: `kanso:read`, `kanso:write` (plus `openid profile email offline_access`).
  A token without `kanso:write` gets read-only tools; calling a write tool
  answers with an `insufficient_scope` challenge so the client can step up.
- Sign-in reuses `/login` (and `/signup`); the flow continues after sign-in.
  Consent at `/oauth/consent` shows the app, its site, the account, and what it
  asks for; the user allows or denies.
- Connected apps are listed in Settings → API & MCP and can be disconnected:
  the consent and the app's refresh/access tokens are deleted, and `/api/mcp`
  checks consent on every request, so already-issued JWTs stop working at once
  (401 with a `resource_metadata` challenge; the app must re-authorize).

**API tokens** — personal, per workspace.
- `ApiToken { userId, workspaceId, name, prefix, tokenHash, access READ|WRITE,
  projectIds[], lastUsedAt?, expiresAt?, revokedAt? }`. Secret format
  `kanso_<40 random base62>`; shown once; only its SHA-256 is stored.
- Sent as `Authorization: Bearer kanso_…` to `/api/mcp` only (REST stays
  session-only).
- Any member, guests included, can create tokens for themselves in a workspace
  they belong to; at most 20 active per user per workspace. Expiry: 30 / 90 /
  365 days or never. Optional project list limits the token to those projects.
- Revocable by their owner. A revoked or expired token, or one whose owner left
  the workspace, is rejected with 401. `lastUsedAt` is updated at most once a minute.

**Effective access** = the user's current role in the workspace, capped by the
credential:
- `Ctx.limits = { write: boolean; projectIds: string[] | null }` is set for every
  token-based request (OAuth or API token).
- Read-only credentials can only `workspace.read` / `project.read`.
- A project list hides every other project (same 404 as a missing one) and
  forbids creating projects.
- Tokens never perform the actions agents never may (delete projects or the
  workspace, members, integrations, moderation), whatever the role.

**Workspace selection.** API tokens are bound to their workspace. OAuth tokens
belong to the user: tools take an optional `workspace` slug; when omitted and
the user has exactly one workspace it is used, otherwise the tool errors with
the list of slugs.

**Rate limits.** 120 requests a minute per credential on `/api/mcp` (429 with
`Retry-After`), in memory per server instance. OAuth endpoints use Better
Auth's built-in per-IP limits (production).

## MCP surface
Tools (annotated `readOnlyHint` / `destructiveHint` / `idempotentHint`):

| Tool | Kind | Notes |
|------|------|-------|
| `whoami` | read | user, workspace(s), credential access |
| `list_workspaces` | read | |
| `list_projects` | read | key, name, mode, open/done counts |
| `get_project(project)` | read | columns + categories, labels, members |
| `search_issues(query, limit?)` | read | the issue query language |
| `get_issue(key)` | read | sub-issues, comments, recent activity |
| `get_my_work` | read | open issues assigned to me, by priority |
| `create_issue` | write | project, title, type, priority, status, assignee, labels, epic, parent (→ sub-issue), estimate, due date, description, acceptance criteria |
| `update_issue(key, …)` | write | same fields; labels by name |
| `move_issue(key, status)` | write | by column name or category (`todo`/`in_progress`/`done`); appended to the column |
| `create_subtasks(key, titles[])` | write | up to 20 |
| `assign_issue(key, assignee)` | write | email, `me`, or `null` |
| `add_comment(key, body)` | write | Markdown |
| `bulk_update_issues(keys[], changes)` | write | up to 50, one project; asks the user to confirm (elicitation) when the client supports it |

Names (status, labels, assignee, epic, project) are resolved to ids in the MCP
layer; unknown names are errors listing the valid ones.

Resources: `issue://{workspace}/{key}` (Markdown) and
`project://{workspace}/{key}/workflow` (columns and what each category means).
The workspace segment is needed because keys are unique per workspace only.

Prompts: `break_down_epic(key)`, `plan_sprint(project)`, `write_standup()`.

Not exposed: deleting anything, project/column/label management, members,
invites, integrations. Coming later: `link_pull_request` (11),
`claim_issue` / `release_issue` / `report_progress` (12).

Transport: MCP TypeScript SDK v2 `createMcpHandler`, stateless — the 2026-07-28
protocol plus the stateless 2025 fallback for older clients.

## Activity
- `api_token.created`, `api_token.revoked` (workspace-level).
- Tool writes record their usual actions; the `via` is `mcp` or `api_token`.

## API
- `GET/POST /api/workspaces/[slug]/tokens`, `DELETE /api/workspaces/[slug]/tokens/[id]`.
- `GET /api/oauth/apps`, `DELETE /api/oauth/apps/[id]` — the signed-in user's
  connected apps (user-level, not per workspace).
- `POST /api/mcp` (MCP), plus Better Auth's `/api/auth/oauth2/*` and the
  well-known routes (`/.well-known/oauth-protected-resource[/api/mcp]`,
  `/.well-known/oauth-authorization-server/api/auth`), forwarded to Better Auth.

## UI
- Settings → **API & MCP**: connection instructions (server URL, Claude Code and
  JSON config snippets), token list (name, prefix, access, projects, created,
  last used, expires) with create and revoke, and connected apps with disconnect.
- `/oauth/consent`: app name/logo/site, account, scopes in plain words, Allow / Deny.

## Scope — out
REST access with API tokens, WebMCP, token usage analytics, per-tool scopes,
admin view of other members' tokens.

## Acceptance criteria
- [x] An MCP client connects over OAuth (discovery → sign-in → consent → token) and lists tools.
- [x] The same client works with an API token in the `Authorization` header.
- [x] Read-only credentials can read but not write; project-limited tokens see only their projects.
- [x] Guests stay read-only (comment only) through MCP; nothing exceeds the user's role.
- [x] Revoked/expired tokens and removed members get 401.
- [x] Tool writes appear in the issue activity like web edits.
- [x] Tokens UI creates (secret shown once), lists, and revokes; connected apps can be disconnected.
- [x] Services and MCP tools are tested, including the caps.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` clean.
