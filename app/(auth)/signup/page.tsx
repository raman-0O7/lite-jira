import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthCard } from "@/components/auth/auth-card";
import { SignupForm } from "@/components/auth/signup-form";
import { getSession } from "@/lib/auth";
import { safeNext, withNext } from "@/lib/safe-next";

export const metadata: Metadata = {
  title: "Sign up · Kanso",
};

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const next = safeNext((await searchParams).next);
  // Authenticated users should never see the signup page.
  const session = await getSession();
  if (session) {
    redirect(next);
  }

  return (
    <AuthCard
      title="Create your account"
      description="Set up your account to start tracking work."
      footerPrompt="Already have an account?"
      footerLinkLabel="Sign in"
      footerLinkHref={withNext("/login", next)}
    >
      <SignupForm next={next} />
    </AuthCard>
  );
}
