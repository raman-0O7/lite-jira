import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  // Carries the signed OAuth query through sign-in and consent (MCP clients).
  plugins: [oauthProviderClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;
