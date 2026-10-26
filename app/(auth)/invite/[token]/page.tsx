import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { InviteActions } from "@/components/workspace/InviteActions";
import { getSession } from "@/lib/auth";
import { getInvitePreview, type InviteStatus } from "@/lib/services/invites";

export const metadata: Metadata = {
  title: "Invitation · Kanso",
  // The token is in the URL: don't hand it to other sites as a referrer.
  referrer: "no-referrer",
};

const ROLE_NOUN = { OWNER: "an owner", ADMIN: "an admin", MEMBER: "a member", GUEST: "a guest" };

const UNUSABLE: Record<Exclude<InviteStatus, "valid">, string> = {
  expired: "This invite has expired. Ask whoever invited you for a new link.",
  used: "This invite has already been used. If that was you, the workspace is in your list.",
  revoked: "This invite was revoked. Ask whoever invited you for a new one.",
};

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const [preview, session] = await Promise.all([getInvitePreview(token), getSession()]);
  const next = encodeURIComponent(`/invite/${token}`);

  const unusable = !preview
    ? "This invite link isn’t valid. Check that you copied all of it."
    : preview.status !== "valid"
      ? UNUSABLE[preview.status]
      : null;

  if (!preview || unusable) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Invite can’t be used</CardTitle>
          <CardDescription>{unusable}</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild variant="outline" className="w-full">
            <Link href={session ? "/projects" : "/login"}>
              {session ? "Go to your projects" : "Sign in"}
            </Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  const wrongAccount =
    session !== null &&
    preview.email !== null &&
    preview.email !== session.user.email.toLowerCase();

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl">Join {preview.workspace.name}</CardTitle>
        <CardDescription>
          {preview.invitedBy ? `${preview.invitedBy} invited you` : "You’re invited"} to join as{" "}
          {ROLE_NOUN[preview.role]}.
          {preview.role === "GUEST" ? " Guests see only the projects shared with them." : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {session ? (
          <>
            <p className="text-sm text-muted-foreground">
              {wrongAccount
                ? `This invite is for ${preview.email}, but you’re signed in as ${session.user.email}.`
                : `Signed in as ${session.user.email}.`}
            </p>
            <InviteActions token={token} wrongAccount={wrongAccount} />
          </>
        ) : (
          <>
            {preview.email ? (
              <p className="text-sm text-muted-foreground">
                Use <span className="font-medium text-foreground">{preview.email}</span> to accept.
              </p>
            ) : null}
            <Button asChild className="w-full">
              <Link href={`/signup?next=${next}`}>Create an account</Link>
            </Button>
            <Button asChild variant="outline" className="w-full">
              <Link href={`/login?next=${next}`}>I already have an account</Link>
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
