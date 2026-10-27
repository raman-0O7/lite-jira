"use client";

import { CheckIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";

type Props = {
  app: { name: string; site: string | null; logo: string | null };
  account: { name: string; email: string };
  scopes: { scope: string; label: string }[];
  redirectHost: string | null;
};

export function ConsentForm({ app, account, scopes, redirectHost }: Props) {
  const [pending, setPending] = useState<"allow" | "deny" | null>(null);

  async function decide(accept: boolean) {
    setPending(accept ? "allow" : "deny");
    // The client plugin adds the signed oauth_query; the response redirects
    // back to the app (with a code, or access_denied) and the client follows it.
    const { data, error } = await authClient.$fetch<{ redirect?: boolean; url?: string }>(
      "/oauth2/consent",
      { method: "POST", body: { accept } },
    );
    if (error || !data?.url) {
      setPending(null);
      toast.error(error?.message ?? "Couldn't complete authorization. Start again from the app.");
      return;
    }
    if (!data.redirect) window.location.href = data.url;
  }

  return (
    <Card className="w-full max-w-sm bg-background shadow-panel [--card-spacing:--spacing(6)]">
      <CardHeader className="items-center text-center">
        {app.logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- third-party logo URL from the client's metadata
          <img src={app.logo} alt="" referrerPolicy="no-referrer" className="mx-auto size-11 rounded-lg border object-contain" />
        ) : (
          <div className="mx-auto flex size-11 items-center justify-center rounded-lg border bg-muted text-lg font-semibold">
            {app.name.charAt(0).toUpperCase()}
          </div>
        )}
        <CardTitle className="text-[19px] font-semibold tracking-[-0.02em]">
          {app.name} wants to access Kanso
        </CardTitle>
        <CardDescription>
          {app.site ? <>From {app.site}. </> : null}
          Signed in as {account.name} ({account.email}).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm font-medium">It will be able to:</p>
        <ul className="flex flex-col gap-2">
          {scopes.map((s) => (
            <li key={s.scope} className="flex items-start gap-2 text-sm text-muted-foreground">
              <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary-text" aria-hidden />
              <span>{s.label}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          It acts with your role in each workspace and its changes appear in issue history as you.
          You can disconnect it any time in Settings → API &amp; MCP.
        </p>
      </CardContent>
      <CardFooter className="flex-col gap-2 border-t bg-transparent py-4">
        <div className="flex w-full gap-2">
          <Button variant="outline" className="flex-1" disabled={pending !== null} onClick={() => decide(false)}>
            {pending === "deny" ? "Denying…" : "Deny"}
          </Button>
          <Button className="flex-1" disabled={pending !== null} onClick={() => decide(true)}>
            {pending === "allow" ? "Allowing…" : "Allow"}
          </Button>
        </div>
        {redirectHost ? (
          <p className="text-center text-xs text-muted-foreground">You&apos;ll be sent back to {redirectHost}.</p>
        ) : null}
      </CardFooter>
    </Card>
  );
}
