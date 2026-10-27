import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthCard } from "@/components/auth/auth-card";
import { LoginForm } from "@/components/auth/login-form";
import { getSession } from "@/lib/auth";
import { oauthQuery, safeNext, withNext } from "@/lib/safe-next";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = safeNext(params.next);
  // Mid-OAuth (an MCP client asked to connect), the flow resumes after sign-in.
  const oauth = oauthQuery(params);
  // Authenticated users should never see the login page.
  const session = await getSession();
  if (session && !oauth) {
    redirect(next);
  }

  return (
    <AuthCard
      title="Sign in"
      description="Welcome back. Enter your details to continue."
      footerPrompt="Don't have an account?"
      footerLinkLabel="Sign up"
      footerLinkHref={oauth ? `/signup?${oauth}` : withNext("/signup", next)}
    >
      <LoginForm next={next} />
    </AuthCard>
  );
}
