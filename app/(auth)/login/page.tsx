import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthCard } from "@/components/auth/auth-card";
import { LoginForm } from "@/components/auth/login-form";
import { getSession } from "@/lib/auth";
import { safeNext, withNext } from "@/lib/safe-next";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const next = safeNext((await searchParams).next);
  // Authenticated users should never see the login page.
  const session = await getSession();
  if (session) {
    redirect(next);
  }

  return (
    <AuthCard
      title="Sign in"
      description="Welcome back. Enter your details to continue."
      footerPrompt="Don't have an account?"
      footerLinkLabel="Sign up"
      footerLinkHref={withNext("/signup", next)}
    >
      <LoginForm next={next} />
    </AuthCard>
  );
}
