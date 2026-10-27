import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthCard } from "@/components/auth/auth-card";
import { SignupForm } from "@/components/auth/signup-form";
import { getSession } from "@/lib/auth";
import { oauthQuery, safeNext, withNext } from "@/lib/safe-next";

export const metadata: Metadata = {
  title: "Sign up",
};

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const params = await searchParams;
  const next = safeNext(params.next);
  // Mid-OAuth (an MCP client asked to connect), the flow resumes after sign-in.
  const oauth = oauthQuery(params);
  // Authenticated users should never see the signup page.
  const session = await getSession();
  if (session && !oauth) {
    redirect(next);
  }

  return (
    <AuthCard
      title="Create your account"
      description="Set up your account to start tracking work."
      footerPrompt="Already have an account?"
      footerLinkLabel="Sign in"
      footerLinkHref={oauth ? `/login?${oauth}` : withNext("/login", next)}
    >
      <SignupForm next={next} />
    </AuthCard>
  );
}
