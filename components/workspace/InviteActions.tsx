"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { acceptInvite } from "@/lib/api/workspaces";
import { signOut } from "@/lib/auth-client";

/** Accept button for a signed-in user, or a way out when they're signed in as someone else. */
export function InviteActions({
  token,
  wrongAccount,
}: {
  token: string;
  wrongAccount: boolean;
}) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  // The (auth) pages have no React Query provider, so this is a plain handler.
  const [joining, setJoining] = useState(false);

  async function accept() {
    setJoining(true);
    try {
      const { slug } = await acceptInvite(token);
      router.push(`/${slug}/projects`);
      router.refresh();
    } catch (error) {
      setJoining(false);
      toast.error((error as Error).message);
    }
  }

  if (wrongAccount) {
    return (
      <Button
        className="w-full"
        variant="outline"
        loading={signingOut}
        loadingText="Signing out…"
        onClick={async () => {
          setSigningOut(true);
          await signOut();
          router.push(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
          router.refresh();
        }}
      >
        Sign in with another account
      </Button>
    );
  }

  return (
    <Button
      className="w-full"
      loading={joining}
      loadingText="Joining…"
      onClick={accept}
    >
      Accept invite
    </Button>
  );
}
