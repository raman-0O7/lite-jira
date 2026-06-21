import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthCard } from "@/components/auth/auth-card";
import { LoginForm } from "@/components/auth/login-form";
import { getSession } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Sign in · Lite Jira",
};

export default async function LoginPage() {
  // Authenticated users should never see the login page.
  const session = await getSession();
  if (session) {
    redirect("/boards");
  }

  return (
    <AuthCard
      title="Sign in"
      description="Welcome back. Enter your details to continue."
      footerPrompt="Don't have an account?"
      footerLinkLabel="Sign up"
      footerLinkHref="/signup"
    >
      <LoginForm />
    </AuthCard>
  );
}
