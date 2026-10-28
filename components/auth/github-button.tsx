"use client";

import { useState } from "react";
import { toast } from "sonner";

import { GitHubMark as GitHubIcon } from "@/components/icons/GitHubMark";
import { Button } from "@/components/ui/button";
import { signIn } from "@/lib/auth-client";

export function GitHubButton({ callbackURL = "/projects" }: { callbackURL?: string }) {
  const [isLoading, setIsLoading] = useState(false);

  async function handleClick() {
    setIsLoading(true);
    const { error } = await signIn.social({
      provider: "github",
      callbackURL,
    });

    // On success the browser is redirected to GitHub, so we only reach
    // this point (with the button still disabled) when something failed.
    if (error) {
      setIsLoading(false);
      toast.error(
        error.message ??
          "GitHub sign-in is unavailable. Make sure GitHub OAuth is configured.",
      );
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      onClick={handleClick}
      loading={isLoading}
      loadingText="Redirecting…"
    >
      <GitHubIcon className="size-4" />
      Continue with GitHub
    </Button>
  );
}
