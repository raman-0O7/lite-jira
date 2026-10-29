# Setting up the GitHub App

Kanso talks to GitHub through a GitHub App (see
[`features/11-github-app.md`](features/11-github-app.md)). Create **one app for
production** and **a separate one for local development**: GitHub needs a
public webhook URL, so the dev app points at a tunnel.

## The quick way

On your deployed Kanso, open **Settings → Integrations** as an admin and click
**Create on GitHub**. GitHub fills in every setting below from a manifest; you
confirm, come back, and Kanso shows the environment variables once. Add them to
your host (on Vercel, paste the block into Project → Settings → Environment
Variables), redeploy, then continue at [4. Use it](#4-use-it). Kanso doesn't
keep the credentials. See [`features/15-github-setup.md`](features/15-github-setup.md).

The rest of this page is the manual way.

## 1. Create the app

Go to GitHub → Settings → Developer settings → GitHub Apps → **New GitHub App**,
or under an organization: Organization settings → Developer settings. Fill in:

| Field | Value |
|---|---|
| GitHub App name | `Kanso` (dev: `Kanso Dev (yourname)`) |
| Homepage URL | your `BETTER_AUTH_URL` |
| Callback URL | `<BETTER_AUTH_URL>/api/github/callback` |
| Request user authorization (OAuth) during installation | **On** |
| Expire user authorization tokens | On (Kanso doesn't keep them) |
| Setup URL | leave empty (ignored when the option above is on) |
| Webhook → Active | On |
| Webhook URL | `<public URL>/api/github/webhooks` |
| Webhook secret | a long random string → `GITHUB_WEBHOOK_SECRET` |

**Repository permissions:**
- Issues: **Read and write**
- Pull requests: **Read-only**
- Checks: **Read-only**
- Metadata: Read-only (required)

**Subscribe to events:** Issues, Pull request, Check suite. (Installation
and Installation repositories events are always sent to the app.)

**Where can this app be installed?** Choose "Any account" if other people's
organizations should be able to use your Kanso; otherwise "Only on this
account".

Equivalent manifest, for the [manifest flow](https://docs.github.com/apps/sharing-github-apps/registering-a-github-app-from-a-manifest):

```json
{
  "name": "Kanso",
  "url": "https://kanso.example.com",
  "callback_urls": ["https://kanso.example.com/api/github/callback"],
  "request_oauth_on_install": true,
  "hook_attributes": { "url": "https://kanso.example.com/api/github/webhooks", "active": true },
  "public": false,
  "default_permissions": { "issues": "write", "pull_requests": "read", "checks": "read", "metadata": "read" },
  "default_events": ["issues", "pull_request", "check_suite"]
}
```

## 2. Collect the credentials

On the app's page:
- **App ID** → `GITHUB_APP_ID`
- the app's URL slug (`github.com/apps/<slug>`) → `GITHUB_APP_SLUG`
- **Client ID** → `GITHUB_APP_CLIENT_ID`
- **Generate a new client secret** → `GITHUB_APP_CLIENT_SECRET`
- **Generate a private key** (downloads a `.pem`) → `GITHUB_APP_PRIVATE_KEY`. Put
  the whole PEM on one line with `\n` for line breaks, or use a multi-line
  value if your host supports it.

Also set `ENCRYPTION_KEY` (32+ random characters, e.g. `openssl rand -base64 32`).
It's required in production.

## 3. Local development with a tunnel

```bash
npx smee-client --url https://smee.io/<your-channel> --target http://localhost:3000/api/github/webhooks
```

Use the smee URL as the dev app's webhook URL. `BETTER_AUTH_URL` (and the
callback URL) can stay `http://localhost:3000`.

## 4. Use it

1. An admin opens **Settings → Integrations → Install GitHub App**, picks the
   account and repositories, and approves.
2. Each person clicks **Link GitHub account** (the installer is linked
   automatically).
3. An admin connects repositories to projects. Assigned open issues are
   imported right away, and webhooks keep things in sync from then on.

To revoke access completely, uninstall the app on GitHub. **Remove** in Kanso
only forgets the installation.
