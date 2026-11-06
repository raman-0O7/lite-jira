# Feature 20 — In-app AI

**Depends on 07.**

## Goal
Help people do the tedious parts of issue tracking faster, without changing how
Kanso works. AI never writes anything on its own: it **suggests**, the person
looks at the suggestion, and what they accept goes through the same services
as any edit (same permissions, same activity history, attributed to them).

Five places, each where people already are:

| Where | What it does |
|---|---|
| **New issue** dialog | "Fill in": turn a sentence like "urgent: Safari login loops, give it to Priya" into a title, description, type, priority and assignee. The fields fill in; the person reviews and creates (or undoes). |
| **Sub-issues** on an issue | "Break down": suggests sub-issues; the person ticks the ones they want and adds them. |
| **Issues imported from GitHub** | "Triage": suggests type, priority, labels and estimate; the person picks which to apply. |
| **Issue activity** | "Summarize": a short summary of the description and the discussion, for long threads. Read-only. |
| **Project header** | "Ask": a question about the project ("what's blocking the release?", "what is Priya working on?"), answered from its issues, with issue keys as links. Read-only. |

## Who pays (PLAN-v2 §1 "AI billing")
Claude through the **Claude API**, paid per token. Never Claude.ai
credentials, and no Claude.ai login. In order:

1. **The workspace's own Claude API key** (Settings → AI). An admin pastes it
   once, or reuses the workspace agent's key with one click (feature 18).
2. **Kanso's platform key**, when the server sets `AI_PLATFORM_API_KEY`: AI
   works with no setup, capped at `AI_PLATFORM_DAILY_LIMIT` requests per
   workspace per day (UTC; default 50). Over the cap, people are told to try
   tomorrow or ask an admin to add the workspace's own key.
3. Neither: AI is off, and the AI buttons don't appear. Admins see the AI tab
   saying how to turn it on.

Sign in with ChatGPT (an OpenAI plan) is left out for now: it needs OpenAI's
partner approval for a hosted app.

## Rules
| | Who |
|---|---|
| Use AI (all five) | members and up, in the web app. Guests, API tokens and agents can't (they would spend the workspace's money). |
| Settings → AI: key, model, on/off | admins (`workspace.update`) |
| See usage (requests and estimated cost this month) | admins |

- **The key** is stored encrypted (`lib/crypto.ts`), shown only as its last 4
  characters, and never logged or sent to the browser. Saving checks it with a
  cheap call; a rejected key is a 400 ("Claude rejected that API key").
- **Off switch.** Admins can turn AI off for the workspace without removing the
  key; the buttons disappear for everyone.
- **Every request is scoped** to what the person can see: their workspace, and
  their projects if their access is limited to some.
- **Imported GitHub text is untrusted.** Issue text is wrapped in
  `<untrusted>` tags in the prompt, and the instructions say it's data, never
  instructions. Output is parsed against a schema; assignees and labels must
  be ids from the lists Kanso sent (anything else is dropped), and nothing is
  applied without the person.
- **Errors never leak internals**: "Claude rejected the workspace's API key.
  An admin can update it in Settings → AI.", "Claude is busy right now. Try again in a minute.",
  "Claude declined this request".

## Model
The admin picks the model in Settings → AI:

| Model | |
|---|---|
| Claude Opus 5.5 (default) | best results |
| Claude Sonnet 5.5 | balanced |
| Claude Haiku 5.5 | fastest and cheapest |

Requests use structured outputs (`messages.parse` + a Zod schema) at `effort:
"low"`, which keeps answers quick; each has a 60-second timeout.

## Data
```prisma
model AiSettings {           // one per workspace, created on first save
  workspaceId String  @id
  enabled     Boolean @default(true)
  model       String  @default("claude-opus-5-5")
  apiKeyEnc   String? // AES-256-GCM
  apiKeyHint  String? // last 4 characters
}
model AiUsage {              // one row per workspace per UTC day
  workspaceId      String
  day              DateTime @db.Date
  requests         Int      // all requests
  platformRequests Int      // those on Kanso's key (the daily cap)
  inputTokens      Int
  outputTokens     Int
  costUsd          Float    // estimate from list prices
}
```

## API (web session only)
| Route | |
|---|---|
| `GET /api/workspaces/[slug]/ai` | `{ ai: { available, reason } }` for everyone; admins also get `settings` (enabled, model, key hint, source, whether the workspace agent's key can be reused, this month's usage) |
| `PUT /api/workspaces/[slug]/ai` | admins: `{ apiKey?, model?, enabled?, useAgentKey? }`; `apiKey: null` removes the key |
| `POST /api/projects/[id]/ai/draft` | `{ text }` → `{ title, description, type, priority, assigneeUserId }` |
| `POST /api/projects/[id]/ai/ask` | `{ question }` → `{ answer }` (Markdown; issue keys become links) |
| `POST /api/issues/[id]/ai/breakdown` | → `{ subIssues: [{ title }] }` (up to 8) |
| `POST /api/issues/[id]/ai/triage` | → `{ type, priority, labelIds, estimate, reason }` |
| `POST /api/issues/[id]/ai/summary` | → `{ summary }` |

Applying a suggestion uses the existing endpoints: create issue, create
sub-issue, update issue.

"Ask" sends the project's issues as a compact list (key, title, status, type,
priority, assignee, labels, due date, sprint, blockers, last update): every
open issue and the 50 most recently finished, up to 400.

## Acceptance
- With no key and no platform key, no AI buttons show; Settings → AI explains
  how to turn it on. Members don't see the AI tab.
- An admin saves a key (or reuses the workspace agent's): the buttons appear
  for members; guests never see them.
- Fill in, Break down, Triage, Summarize and Ask each return a suggestion; the
  writes happen only when the person accepts, and show in activity as theirs.
- A suggested assignee who isn't a member, or a label from another project, is
  dropped.
- On the platform key, request 51 of the day is refused with a clear message.
- The key never appears in a response, the page, or the logs.
