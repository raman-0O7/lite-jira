# Feature 23 — Connect your AI

**Depends on 10.**

## Goal
People pay for different AI apps: ChatGPT, Claude, Codex, Gemini, Cursor. Each
of them can already reach Kanso: Kanso is a remote MCP server with OAuth
(feature 10), so the AI app works with the person's own plan and Kanso pays
nothing. But today Settings → API & MCP shows one generic snippet, written for
Claude Code, and nobody has checked that ChatGPT can actually connect.

This feature makes Kanso **work with every major AI app, and makes that
obvious**:

1. A **"Connect your AI"** page with exact setup steps for each app.
2. **ChatGPT verified end to end** against Kanso's OAuth server, with whatever
   fixes that turns up.
3. A **tool contract test**, so a change to an MCP tool can't silently break
   ChatGPT (which freezes a snapshot of the tools; see "ChatGPT" below).

No new billing: every app here runs on the person's own subscription or plan.
Kanso never asks for, stores, or proxies their AI account credentials
(PLAN-v2 §1 "AI billing").

## What each app can do (as of November 2026)

| App | How it connects | Plans | What works |
|---|---|---|---|
| **ChatGPT** (web) | Plugins → + → **Add custom MCP server**, OAuth | Business, Enterprise/Edu: full MCP (read and write) | Everything |
| | | Pro: read/fetch only | Reading issues and projects; no writes |
| | | Plus, Free, Go: not offered by OpenAI | — (use Codex instead) |
| **Codex** (CLI, IDE, app) | `codex mcp add`, OAuth sign-in | Any ChatGPT plan with Codex, or an OpenAI API key | Everything |
| **Claude** (claude.ai, desktop, mobile) | Settings → Connectors → **Add custom connector**, OAuth | Any Claude plan that offers custom connectors | Everything |
| **Claude Code** | `claude mcp add --transport http` | Any | Everything |
| **Gemini CLI** | `gemini mcp add --transport http` | Any | Everything |
| **Cursor** | One-click install link, or `mcp.json` | Any | Everything |
| **VS Code** (Copilot agent mode) | One-click install link, or `mcp.json` | Any | Everything |
| **Other MCP clients** | Server URL, or an API token for clients without OAuth | — | Depends on the client |

Exact menu names and commands are checked against each vendor's docs when this
feature is built, and the page links to each vendor's own help article, so a
renamed menu is a docs fix and not a code change.

**ChatGPT Plus users** are the largest group this table leaves out. The page
tells them plainly: "ChatGPT Plus can't add custom MCP servers yet. Use Codex
with your ChatGPT sign-in, or ask your workspace admin about ChatGPT Business."
It doesn't promise more than OpenAI offers.

## The page

**Settings → API & MCP** becomes **Settings → Connect your AI**. The URL stays
`/settings/api`, and the old title redirects. It's for everyone in the
workspace, guests included (MCP acts as the person, with their role).

```
Connect your AI
Use Kanso from the AI app you already pay for. It signs in as you and can do what you can do here.

[ ChatGPT ] [ Claude ] [ Codex ] [ Claude Code ] [ Gemini CLI ] [ Cursor ] [ VS Code ] [ Other ]

  ① Open ChatGPT → Plugins → + → Add custom MCP server      [Open ChatGPT ↗]
  ② Name: Kanso                                              [Copy]
     URL:  https://…/api/mcp                                 [Copy]
     Authentication: OAuth
  ③ Tick "I understand and want to continue", then Create.
  ④ Sign in to Kanso and choose what ChatGPT may do.
  ⑤ In a chat, type @Kanso and ask: "What's assigned to me?"
  Plans: Business and Enterprise get read and write; Pro gets read-only. Plus: use Codex.
  ChatGPT's help ↗

Connected apps (existing list, feature 10) · API tokens (existing, feature 10)
```

- **Tabs, one per app.** Steps reuse the numbered stepper from the agent setup
  dialog (feature 13): numbered rail, copy buttons, the app's own buttons
  shown as chips. CLI apps show one command per copy block.
- **The last-used tab is remembered** per browser (localStorage, wrapped in
  try/catch; the page works without it).
- **"Try it" prompt** at the end of each tab, the same for all apps:
  "What's assigned to me in Kanso?"
- **Connected apps** (`listConnectedApps`, feature 10) stays below the tabs. A
  row whose client is a known app shows its name ("ChatGPT", "Claude",
  "Cursor"…) from the OAuth client's name or redirect host, instead of a raw
  host or "Unnamed app".
- **API tokens** stay at the bottom, under "For clients without OAuth".

### Get started checklist (feature 13)
"Connect your AI" becomes a checklist step for every member: done once the
person has at least one connected app or API token. Its button opens this
page.

## ChatGPT compatibility (the work behind the ChatGPT tab)

Run the ChatGPT flow end to end against a deployed preview: a ChatGPT
Business test workspace adds Kanso as a custom MCP server, signs in, scans the
tools, and calls a read tool and a write tool. Check, and fix whatever fails:

| Check | Where |
|---|---|
| Discovery: `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server` answer for the MCP URL, and `scopes_supported` lists `offline_access` | `app/.well-known/…` |
| Registration: ChatGPT registers with dynamic client registration (or a Client ID Metadata Document) and its redirect URI is accepted | `lib/auth.ts` |
| Consent screen shows "ChatGPT" and the scopes in plain words | `/oauth/consent` |
| A refresh token is issued, and a refresh works after the 1-hour write-scope access token expires | `scopeExpirations`, `offline_access` |
| Tool scan lists every tool with `readOnlyHint` / `destructiveHint` (ChatGPT uses these to decide when to ask for confirmation) | `lib/mcp/tools.ts` |
| `bulk_update_issues` without elicitation: ChatGPT confirms write actions itself, so the tool must stay safe when the client doesn't support elicitation | `lib/mcp/tools.ts` |
| Errors come back as tool results with a readable message, not as protocol errors that ChatGPT shows as "something went wrong" | `lib/mcp/format.ts` |
| Rate limit (120/min per credential) holds up under ChatGPT's scan plus a conversation | `lib/mcp/rate-limit.ts` |

Same smoke test, shorter, for Claude (custom connector), Codex CLI and Gemini
CLI. The results go in a table at the end of this spec when the feature ships
(app, date, plan, result).

### Tool contract test
ChatGPT keeps a **frozen snapshot** of a server's tools once an admin publishes
it. Changes that aren't backward compatible make calls fail until an admin
refreshes the app. Nobody gets told about it.

So: a Vitest test (`tests/mcp-contract.test.ts`) lists the MCP server's tools
and compares each one's name, annotations and input schema with a checked-in
snapshot (`tests/__snapshots__/mcp-tools.json`). The rules:

- **Allowed** (the test updates the snapshot with `-u`): a new tool; a new
  *optional* input; a looser constraint; a changed description.
- **Breaking** (the test fails, with a message that says why and points here):
  a removed or renamed tool; a removed input; an optional input made
  required; a narrowed type or enum; a changed annotation from read-only to
  write.

A breaking change is still possible. It needs a deliberate snapshot update and
a line in the release notes that tells ChatGPT admins to refresh Kanso's tools.

## Out of scope
- **A listed ChatGPT app** (OpenAI's app directory, Apps SDK widgets). Later,
  if there is demand: it means OpenAI's review, and it would let Plus users in
  if OpenAI opens apps to them.
- **Sign in with ChatGPT** (each person's plan paying for Kanso's in-app AI):
  needs OpenAI's approval for hosted apps; tracked separately.
- **Codex as an agent** that Kanso dispatches issues to: feature 19.
- **Per-app usage stats.** The connected-apps list shows last use only, as now.

## Acceptance
- Settings → Connect your AI shows a tab for each app in the table, with the
  workspace's real MCP URL in every snippet; every command and button copies.
- The ChatGPT tab states which plans get read and write, read-only, or nothing,
  and points Plus users to Codex.
- A ChatGPT Business workspace adds Kanso, signs in, and from a chat lists the
  person's issues and creates an issue that shows in Kanso's activity as the
  person, via MCP. After more than an hour, it still works without signing in
  again (refresh token).
- The same works from Claude (custom connector), Codex CLI and Gemini CLI.
  The smoke-test table is filled in.
- Connected apps show "ChatGPT", "Claude", "Cursor"… by name.
- The Get started checklist has a "Connect your AI" step that ticks itself
  once the person connects an app or makes an API token.
- `tests/mcp-contract.test.ts` fails on a removed tool, a removed input, or a
  newly required input, and passes on a new optional input.
- `pnpm lint`, `tsc --noEmit`, `pnpm test` and `pnpm build` are clean.
