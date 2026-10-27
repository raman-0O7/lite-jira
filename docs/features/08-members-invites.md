# Feature 08 — Members & invites: team workspaces, roles, guests

**Wave 6 · parallel with 07 · depends on 06.** See [`PLAN-v2.md`](../PLAN-v2.md) §1, §4.

## Goal
Let a solo user become a team: create more workspaces, invite people by email or
link, manage roles, and share single projects with **guests** (a freelancer's
client). Solo users keep a personal workspace that never shows team UI.

## Data model
- `Invite { workspaceId, email?, role, projectIds[], tokenHash (unique),
  invitedById?, expiresAt, acceptedAt?, acceptedById?, revokedAt? }`.
  The token is shown once (in the link); only its SHA-256 is stored.
  `email = null` is a link invite: whoever opens it first can accept it.
- `ProjectAccess { projectId, membershipId }`, unique per pair, cascades with
  both. Only meaningful for guests.

## Rules
**Workspaces**
- Anyone signed in can create a team workspace (they become OWNER). The slug is
  derived from the name or given explicitly: 3–40 characters, `a–z0–9-`, not
  reserved, unique (409 if taken). Slugs can't be changed later (URLs).
- Owners and admins rename a workspace (`workspace.update`). Only an owner
  deletes one (`workspace.delete`); personal workspaces can't be deleted.
- Personal workspaces have exactly one member: no invites, no role changes.

**Invites** (`members.manage`: owners and admins)
- Roles on invite: ADMIN, MEMBER, GUEST (ownership is granted later, by an owner).
  Only owners can invite admins.
- Guest invites may list projects to share; non-guest invites can't.
- Invites expire after 7 days. An admin can revoke one or renew it (new token,
  new expiry — the old link stops working).
- Inviting an email that is already a member → 409; one with a pending invite
  → 409.
- Accepting requires a signed-in user. An email invite only accepts for that
  email (case-insensitive). Accepting is single-use and atomic. A user who is
  already a member is sent to the workspace without using up the invite.

**Members**
- Admins change the roles of members and guests and remove them. Anything that
  involves the ADMIN or OWNER role (granting it, changing or removing someone
  who holds it) needs an owner. Nobody removes themselves; they leave.
- A workspace always keeps at least one owner (demoting or removing the last
  owner → 400; the last owner can't leave).
- Anyone can leave a team workspace (not their personal one).
- Becoming a guest or leaving the workspace unassigns the person's issues there.
  A guest promoted to a full role loses their project-access rows (they now see
  everything).

**Guests**
- A guest sees only projects shared with them (`ProjectAccess`); every other
  project, issue, comment, label, and search result behaves as if it doesn't
  exist (404 / not listed). They can read and comment, nothing else.
- Admins set a guest's projects from the members page.

## Activity
`workspace.created|updated`, `invite.created|revoked|renewed`,
`member.joined|role_changed|removed|left`, `member.projects_changed`.

## API
```
GET|POST   /api/workspaces                            mine / create {name, slug?}
PATCH|DELETE /api/workspaces/[slug]                   rename {name} / delete
POST       /api/workspaces/[slug]/leave
GET        /api/workspaces/[slug]/members             (+ guests' projectIds)
PATCH|DELETE /api/workspaces/[slug]/members/[userId]  {role} / remove
PUT        /api/workspaces/[slug]/members/[userId]/projects  {projectIds}
GET|POST   /api/workspaces/[slug]/invites             pending / create {email?, role, projectIds?}
DELETE     /api/invites/[id]                          revoke
POST       /api/invites/[id]/renew                    → {invite, url}
POST       /api/invites/accept                        {token} → {slug}
```

## Email
`lib/email.ts` sends invite emails through Resend when `RESEND_API_KEY` and
`EMAIL_FROM` are set; otherwise it logs the link to the server console. The
invite response always includes the link, so inviting works without email.

## UI (minimal — the redesign is 09)
- Top bar: workspace switcher (my workspaces, create workspace, settings).
- `/[workspace]/settings/members`: members (role select, guest projects, remove),
  invite form (email or link, role, guest projects), pending invites (copy new
  link, revoke). Personal workspace: a prompt to create a team workspace.
- `/[workspace]/settings/general`: rename, leave, delete.
- `/invite/[token]`: who invited you to what; sign in / sign up (returning to the
  invite), accept, or why it can't be used.
- Login and signup accept `?next=` (same-site paths only).
- Guests get a read-only board (no create, drag, or edit controls).

## Scope — out
Ownership transfer UI beyond role changes, SSO/domain auto-join, seat billing,
notification emails other than invites, agent members (12).

## Acceptance criteria
- [x] Invite → sign up → accept lands the new member in the workspace with the
      invited role (and shared projects for guests).
- [x] Expired, revoked, used, and wrong-email invites are refused with a clear
      message.
- [x] Role rules above are enforced by services (tested), including the
      last-owner guard.
- [x] Guests can't see unshared projects through any route (tested).
- [x] Every mutation writes an Activity row.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` clean.
