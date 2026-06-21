# Feature 01 — Auth flows & UI

**Wave 2 · parallel with Feature 02 · depends on 00.**

## Goal
Working signup, login, logout, and GitHub OAuth using the Better Auth instance
from Feature 00. Protect the app, expose current user in the shell.

## Depends on
- 00: `lib/auth.ts`, `lib/auth-client.ts`, `requireUser()`, shadcn `input/button/card/sonner`.

## Scope — in
- `app/(auth)/login/page.tsx` — email+password form + "Continue with GitHub".
- `app/(auth)/signup/page.tsx` — name, email, password; creates account, signs in.
- Client calls via `auth-client`: `signIn.email`, `signUp.email`,
  `signIn.social({provider:"github"})`, `signOut`.
- Form validation with Zod (`lib/validations/auth.ts` — create it here) + inline errors.
- Route protection: `middleware.ts` (or per-layout `requireUser()`) guarding
  `app/(app)/*`; unauthenticated → `/login`. Authenticated hitting `/login` → `/boards`.
- App shell `app/(app)/layout.tsx`: top bar with app name, user email/avatar,
  logout button (dropdown-menu).
- Redirect after login/signup → `/boards`.
- Loading + error states; toasts on failure.

## Scope — out
Password reset, email verification, profile editing. (Note as future.)

## Files (owns)
```
app/(auth)/login/page.tsx
app/(auth)/signup/page.tsx
app/(app)/layout.tsx          # app shell + guard
middleware.ts                 # if using middleware approach
lib/validations/auth.ts
components/auth/*              # form components
components/app-shell/*        # top bar, user-menu
```
Coordinate: `app/(app)/layout.tsx` is shared with F02/F03 — F01 creates it, others
render children into it. Establish it first.

## Acceptance criteria
- [ ] New user can sign up, lands on `/boards`.
- [ ] Existing user can log in with email/password.
- [ ] "Continue with GitHub" completes OAuth (with real creds) and creates/links account.
- [ ] Logout clears session, redirects to `/login`.
- [ ] Direct visit to `/boards` while logged out → `/login`; logged in `/login` → `/boards`.
- [ ] Wrong password / duplicate email show clear errors.
- [ ] `pnpm build` + `pnpm lint` clean.
