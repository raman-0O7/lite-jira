# Feature 13 — Guided setup & discoverability

**Depends on 08, 10, 11, 12.**

## Goal
People should find out what Kanso can do where they already work, and set
each thing up without missing a step. Two problems motivate this:
- Agents were reachable only from Settings → Agents, as a wall of text.
- That text left out steps in Claude, such as creating the task at
  claude.ai/code/routines.

Three surfaces fix this:

1. **Assignee menu** (on the issue screen and in the new-issue dialog):
   - **Invite people…** and **Add an AI agent…** open the setup in place.
   - People who can't do these see a hint to ask an admin.
2. **Agent setup dialog**: a stepper that replaces the old form and
   instructions. It ticks the Claude connection by itself.
3. **Get started** card on the Projects page:
   - every capability, each one click from its setup;
   - ticks itself as things get done;
   - can be dismissed.

## Setup status
`GET /api/workspaces/[slug]/setup` → `{status, mcpUrl}`, for the caller in
this workspace (`workspace.read`; any member, including guests).

| field | true when |
|-|-|
| `projects` | the caller can see at least one project (guests: shared ones) |
| `teammates` | another member has joined, or an invite is pending (not accepted, revoked or expired) |
| `github` | a GitHub installation that isn't suspended |
| `agents` | the workspace has an agent |
| `assistant` | the caller allowed any OAuth app (user-wide), or has an active personal API token here |
| `claudeConnected` | one of the caller's OAuth consents belongs to a client on claude.ai or claude.com |

How `claudeConnected` is decided:
- It looks at the client's `clientId` (a metadata URL, when CIMD is used) and
  at its `redirectUris`.
- The host must be exactly `claude.ai` or `claude.com`, or a subdomain of
  either, over https.
- Look-alike hosts such as `claude.ai.evil.example` don't count.

`mcpUrl` is the MCP resource URL that the steps ask people to paste.

## Assignee menu
- Rows go below the members and agents, after a separator.
- Shown by role:

  | who | sees |
  |-|-|
  | admins and owners | **Invite people…** and **Add an AI agent…** |
  | members | a hint: ask an admin to invite people or add an AI agent |
  | guests | nothing (they can't assign) |

- In a personal workspace there is nobody to invite, so the invite row and its
  hint are hidden.
- A dialog opens once the menu has closed, so focus moves into the dialog.
- In the new-issue dialog, the setup dialogs are rendered outside its
  `<form>`. React bubbles submit events through portals, which would
  otherwise create the issue.

## Agent setup
`AgentSetupDialog` is used by Settings → Agents, the assignee menu, and Get
started. It is for admins only (`agent.manage`).

1. **Choose a kind.** Each option says what it needs:
   - **Claude Code** (recommended): a paid Claude plan with Claude Code on the
     web, a GitHub repo connected to Claude, about 5 minutes.
   - **Your own agent (MCP)**: an agent you host.

**Claude Code**: Connect → Create task → Link it → Done.

2. **Connect.**
   - Copy the Kanso server URL, then open
     `https://claude.ai/settings/connectors`.
   - Click **Add custom connector**, name it Kanso, paste the URL, then click
     **Connect** and **Allow**.
   - The step polls the setup status every 3s and ticks itself on
     `claudeConnected`.
   - "I've connected it" skips ahead, for cases detection can't see.
3. **Create the task.** Open `https://claude.ai/code/routines` and tick each
   item:
   - New task (or New routine), Set up manually;
   - name it and paste the prompt (copy button);
   - Trigger → API;
   - Advanced settings → Repository;
   - Connectors tab: keep Kanso on;
   - Create, keeping the API token dialog open.

   Continue unlocks only when all six are ticked. The steps follow Claude's
   "Create from the web" docs.
4. **Link it.**
   - Fields: token, fire URL, and name (default "Claude").
   - Both secrets are checked as you type: the URL against the fire URL
     pattern, and the token's length.
   - It says where each value is, and how to get a new token if the dialog was
     closed (Regenerate).
5. **Done.** From an issue's menu it offers **Assign this issue to Claude**,
   which assigns at once.

How the Claude steps are drawn:
- An "In Claude" header names the job and has a button that opens the right
  Claude page.
- Steps sit on a numbered rail. Claude's buttons, tabs and switches appear as
  chips in click order (`New task › Set up manually`). Values to type or pick
  have dashed borders.
- In Create task, only the current step is open. Each step closes when you
  click **Done**, and any title reopens its step. The prompt is a **Copy
  prompt** button; the full text is one click away.

**MCP**: name and an optional webhook URL → Done, which shows these once:
- the agent token;
- the webhook signing secret;
- the `claude mcp add` command.

Closing the dialog resets it, so secrets don't stay in memory.

Settings → Agents is now the list plus one **Add an agent** button. With no
agents, an empty state opens the dialog.

## Agent icons
Claude Code agents show the Claude mark (in Claude's colour, `--claude`) and
MCP agents show a bot (`components/icons/AgentIcon.tsx`). This applies to:
- the assignee menu and its trigger;
- board and list cards, and run badges;
- the issue's Agent block, activity and comments;
- Settings → Agents and the setup dialog.

## Get started
A card at the top of the Projects page. It lists only what the viewer may do:

| item | shown with | done when | action |
|-|-|-|-|
| Create a project | `project.create` | the project list isn't empty | New project dialog |
| Invite your team | `members.manage`, team workspace | `teammates` | Invite dialog |
| Add an AI agent | `agent.manage` | `agents` | Agent setup dialog |
| Connect GitHub | `integrations.manage` | `github` | Settings → Integrations |
| Use Kanso from your AI assistant | everyone | `assistant` | Settings → API & MCP |

The card is hidden in these cases:
- for guests;
- once dismissed;
- when every item shown is done.

Dismissal is stored per browser and workspace in `localStorage`
(`kanso:get-started-dismissed:<slug>`). If storage isn't available, it lasts
until the page reloads.

The status query refetches each time the page mounts, so steps finished
elsewhere tick on return.

The invite form moved to `components/workspace/InvitePeople.tsx`, so Settings
→ Members and the new `InviteDialog` share it.

## Acceptance criteria
- [x] Setup status is per caller and workspace; guests count only shared projects; revoked tokens don't count.
- [x] A claude.ai or claude.com consent ticks Connect without a reload; look-alike hosts don't.
- [x] Claude Code setup can't continue past the task checklist until every item is ticked; a bad fire URL or short token is flagged before submit.
- [x] Agent created from an issue's menu can be assigned to that issue in one click.
- [x] Assignee menu shows invite and add-agent rows to admins, a hint to members, and nothing to guests.
- [x] Get started lists only permitted items, ticks itself, and stays dismissed after a reload.
- [x] Vitest covers setup status; browser walkthrough covers every path.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` clean.
