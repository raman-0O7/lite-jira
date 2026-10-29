# Feature 17 — Personal agents: hand your issue to your Claude

**Depends on 12, 13, 16.**

## Goal
In a team workspace, a manager assigns an issue to Bob and Bob wants Claude to
do it. Before this:
- only admins could add agents, so Bob couldn't connect his own Claude;
- any member could start any agent, so Bob could pick the manager's "Claude".
  That session ran on the **manager's** Claude account and used their plan, and
  when it needed input, only the manager could open it to answer;
- assigning an agent removed the person, so nobody was responsible for the
  issue any more.

Now each member connects their own Claude, only its owner can start it, and
the person stays the assignee while their agent works the issue (the same idea
as Linear's agent delegation; GitHub Copilot likewise runs as whoever assigns
it).

## Rules
| | Who |
|---|---|
| Add an agent (`agent.create`) | members and up; it's theirs |
| Change, disable, delete it, mint its tokens | its owner, or an admin (`agent.manage`) |
| Start a **Claude Code** agent (assign, retry) | **its owner only** (403: "Only Ana can start Claude: it runs on their Claude account. Connect your own Claude in Settings → Agents.") |
| Start an **MCP** agent | any member (`agent.dispatch`): a self-hosted bot is shared |
| Take an agent off an issue | any member (stopping is always safe) |
| Reassign the issue to another person | any member (unchanged, as in Jira and Linear); history records it |

Agents and tokens still never get `agent.create`, `agent.manage` or
`agent.dispatch`.

## The person stays the assignee
`Issue.assigneeUserId` and `Issue.assigneeAgentId` are no longer exclusive:
the person is responsible, the agent works the issue for them.
- **Handing to a Claude Code agent** makes its owner the assignee (they're the
  one who can answer it and who reviews its PR). Bob handing Ana's issue to
  Bob's Claude makes it Bob's; the history shows "Bob took it and handed it to
  Bob's Claude".
- **Handing to an MCP agent** keeps whoever had it, or makes the caller the
  assignee if nobody did.
- **Taking the agent off** ("No agent") cancels its run and keeps the person.
- **Changing the person** cancels the agent's run and takes it off, since it
  worked for the previous assignee. Setting the same person again changes
  nothing.
- **Deleting an agent** leaves its issues with their person.
- Migration `20261029120000_agent_delegation` gives issues already handed to
  an agent their agent's owner as assignee.

## UI
- **Assignee menu:** people as before; then **Hand to an agent** listing only
  the agents you can start (your own Claude Code agents and any MCP agent), and
  **No agent** while one is set. The trigger reads "Bob · Claude".
- **Cards and list rows** show the person's avatar with the agent's badge
  tucked against it.
- **Assignee filter:** an issue matches its person and its agent.
- **Settings → Agents:** every member can add one; each row says "yours" or
  "Ana's"; only your own (or, for admins, any) have Tokens, Disable, Delete.
- **Setup dialog:** names a Claude Code agent "Claude", or "Bob's Claude" when
  "Claude" is taken (names stay unique in a workspace). The Get started item
  is "Connect your Claude" and ticks when *you* have an agent.
- Activity: "handed it to Claude", "took it and handed it to Bob's Claude",
  "took Claude off it".

## Shared Claude accounts
Several people logging into one Claude account isn't something Kanso supports:
Anthropic's consumer terms forbid sharing an account or making it available to
anyone else. For a company:
- **Claude Team or Enterprise:** each member has their own seat with Claude
  Code, connects their own Claude here, and the company is billed per seat.
  This feature is that setup.
- **One workspace-wide agent paid by the company** needs the Claude API
  (an organization API key, billed per token), not a subscription. Planned as
  feature 18: any member hands it work, and because the API can message a
  running session, comments in Kanso reach it.

## Acceptance criteria
- [x] Members add and manage their own agents; admins manage everyone's; guests can't add.
- [x] Only its owner starts a Claude Code agent (assign and retry); MCP agents stay shared.
- [x] Handing to an agent keeps (or sets) the person; No agent keeps the person; a different person stops the agent.
- [x] Menu lists only startable agents; cards, rows, filter and activity show person and agent.
- [x] Setup dialog suggests a free name; Get started counts your own agent.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` clean.
