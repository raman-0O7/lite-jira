"use client";

import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Check, Copy, Download, Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { GitHubMark } from "@/components/icons/GitHubMark";
import { InlineLoading } from "@/components/loading/skeletons";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { copy } from "@/components/workspace/ApiSettings";
import { completeAppSetup, startAppSetup } from "@/lib/api/github";

const APP_NAME_MAX = 34;

/** Post the manifest to GitHub the only way it accepts: a top-level form submit. */
function submitManifest(action: string, manifest: string) {
  const form = document.createElement("form");
  form.method = "post";
  form.action = action;
  const field = document.createElement("input");
  field.type = "hidden";
  field.name = "manifest";
  field.value = manifest;
  form.append(field);
  document.body.append(form);
  form.submit();
}

/**
 * Settings → Integrations before the server has a GitHub App
 * (docs/features/15-github-setup.md "Create the app"). GitHub fills in every
 * setting from a manifest; the admin only names the app.
 */
export function GitHubAppSetup({ setup }: { setup: { defaultName: string; local: boolean } }) {
  const { slug } = useWorkspace();
  const [name, setName] = useState(setup.defaultName);
  const [org, setOrg] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const start = useMutation({
    mutationFn: () => startAppSetup(slug, { name, org, public: isPublic }),
    onSuccess: ({ action, manifest }) => submitManifest(action, manifest),
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <form
      className="flex flex-col gap-4 rounded-lg border bg-surface p-4 shadow-card"
      onSubmit={(event) => {
        event.preventDefault();
        start.mutate();
      }}
    >
      <div>
        <p className="flex items-center gap-2 text-sm font-medium">
          Set up GitHub for this server
          <span className="rounded-full bg-chip px-2 py-px text-xs font-normal text-muted-foreground">One time</span>
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          You run this Kanso server, so you register it on GitHub once. Only you see this. Afterwards every
          workspace, yours included, just clicks Install GitHub App and picks its own GitHub account and
          repositories.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          GitHub fills in every setting; you only pick a name.
        </p>
      </div>

      {setup.local ? (
        <p className="flex gap-2 rounded-md bg-chip px-3 py-2 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-foreground" />
          This server’s address is local, so GitHub can’t deliver webhooks to it. Create the app from your
          deployed Kanso instead, or use a tunnel (see docs/github-app.md).
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gh-app-name">App name</Label>
          <Input
            id="gh-app-name"
            value={name}
            maxLength={APP_NAME_MAX}
            onChange={(event) => setName(event.target.value)}
            required
          />
          <p className="text-xs text-muted-foreground">Must be unique on GitHub. You can change it there.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gh-app-org">Organization (optional)</Label>
          <Input
            id="gh-app-org"
            value={org}
            placeholder="Your personal account"
            onChange={(event) => setOrg(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">Own the app as an organization you administer.</p>
        </div>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-primary"
          checked={isPublic}
          onChange={(event) => setIsPublic(event.target.checked)}
        />
        <span>
          Let other GitHub accounts install it
          <span className="block text-xs text-muted-foreground">
            Needed if people outside your account or organization connect their repositories.
          </span>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" loading={start.isPending} loadingText="Opening GitHub…">
          <GitHubMark className="size-3.5" />
          Create on GitHub
        </Button>
        <p className="text-xs text-muted-foreground">GitHub asks you to confirm, then sends you back here.</p>
      </div>
    </form>
  );
}

/** Mask secrets in the .env block until revealed. */
function masked(env: string) {
  return env
    .split("\n")
    .map((line) => {
      const [key, ...rest] = line.split("=");
      const value = rest.join("=");
      return /SECRET|PRIVATE_KEY/.test(key!) ? `${key}=${"•".repeat(Math.min(24, value.length))}` : line;
    })
    .join("\n");
}

/**
 * Where GitHub sends the admin after creating the app: trade the one-time
 * code for the credentials and show them once, ready to paste into the host.
 */
export function GitHubAppCreated() {
  const { slug } = useWorkspace();
  const params = useSearchParams();
  // Read once: the code is single-use, and it's dropped from the address bar below.
  const [{ code, state }] = useState(() => ({ code: params.get("code"), state: params.get("state") }));
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const complete = useMutation({ mutationFn: () => completeAppSetup(slug, { code: code!, state: state! }) });
  const { mutate } = complete;
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !code || !state) return;
    started.current = true;
    mutate();
    window.history.replaceState(null, "", window.location.pathname);
  }, [code, state, mutate]);

  const back = (
    <Button asChild variant="outline" size="sm" className="self-start">
      <Link href={`/${slug}/settings/integrations`}>Back to Integrations</Link>
    </Button>
  );

  if (!code || !state) {
    return (
      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-sm font-semibold">GitHub App</h2>
        <p className="text-sm text-muted-foreground">
          Nothing to show: the app’s credentials appear here only right after GitHub creates it.
        </p>
        {back}
      </section>
    );
  }
  if (complete.isPending || complete.isIdle) return <InlineLoading label="Getting the app’s credentials from GitHub" />;
  if (complete.isError) {
    return (
      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-sm font-semibold">Couldn’t finish creating the app</h2>
        <p className="text-sm text-muted-foreground">{complete.error.message}</p>
        {back}
      </section>
    );
  }

  const { app, env, webhookSecretMissing } = complete.data;
  const download = () => {
    const url = URL.createObjectURL(new Blob([`${env}\n`], { type: "text/plain" }));
    const link = Object.assign(document.createElement("a"), { href: url, download: "kanso-github-app.env" });
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="flex flex-col gap-5">
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-chip text-foreground">
          <GitHubMark className="size-4" />
        </span>
        <div>
          <h2 className="font-heading text-sm font-semibold">“{app.name}” is created</h2>
          <p className="text-sm text-muted-foreground">
            Finish the one-time server setup. Kanso shows these credentials only now and doesn’t keep
            them. Workspaces never need them: they just install the app.
          </p>
        </div>
      </div>

      <ol className="flex flex-col gap-5 text-sm">
        <li className="flex flex-col gap-2">
          <p>
            <span className="font-medium">1. Add these to the server’s environment variables.</span>{" "}
            <span className="text-muted-foreground">
              On Vercel: Project → Settings → Environment Variables, then paste the whole block into the
              first Key field.
            </span>
          </p>
          <pre className="max-h-56 overflow-auto rounded-md border bg-chip p-3 font-mono text-xs leading-5 break-all whitespace-pre-wrap">
            {revealed ? env : masked(env)}
          </pre>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={async () => {
                await copy(env, "Environment variables");
                setCopied(true);
              }}
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? "Copied" : "Copy all"}
            </Button>
            <Button size="sm" variant="outline" onClick={download}>
              <Download className="size-3.5" />
              Download .env
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRevealed((value) => !value)}>
              {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              {revealed ? "Hide secrets" : "Show secrets"}
            </Button>
          </div>
          {webhookSecretMissing ? (
            <p className="text-xs text-muted-foreground">
              GitHub didn’t return a webhook secret. On the{" "}
              <a className="underline" href={app.url} target="_blank" rel="noreferrer">
                app’s page
              </a>
              , set one and add it as <code className="font-mono">GITHUB_WEBHOOK_SECRET</code>.
            </p>
          ) : null}
        </li>
        <li>
          <span className="font-medium">2. Redeploy</span>{" "}
          <span className="text-muted-foreground">so the server picks them up (Vercel → Deployments → Redeploy).</span>
        </li>
        <li>
          <span className="font-medium">3. Install the app.</span>{" "}
          <span className="text-muted-foreground">
            Back in Settings → Integrations, click Install GitHub App, choose your account and repositories,
            then connect each one to a project. Other workspaces do the same with their own accounts.
          </span>
        </li>
      </ol>
      {back}
    </section>
  );
}
