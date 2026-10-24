import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthCard } from "@/components/auth/auth-card";
import { SignupForm } from "@/components/auth/signup-form";
import { getSession } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Sign up · Kanso",
};

export default async function SignupPage() {
  // Authenticated users should never see the signup page.
  const session = await getSession();
  if (session) {
    redirect("/projects");
  }

  return (
    <AuthCard
      title="Create your account"
      description="Set up your account to start tracking work."
      footerPrompt="Already have an account?"
      footerLinkLabel="Sign in"
      footerLinkHref="/login"
    >
      <SignupForm />
    </AuthCard>
  );
}
