import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { ConsentForm } from "@/components/oauth/consent-form";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { auth, getSession } from "@/lib/auth";
import { describeScopes } from "@/lib/mcp/scopes";
import { oauthQuery } from "@/lib/safe-next";

export const metadata: Metadata = {
  title: "Authorize app",
};

type PublicClient = {
  client_id: string;
  client_name?: string;
  client_uri?: string;
  logo_uri?: string;
};

function hostOf(url: string | undefined | null) {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function Problem({ message }: { message: string }) {
  return (
    <Card className="w-full max-w-sm bg-background shadow-panel [--card-spacing:--spacing(6)]">
      <CardHeader>
        <CardTitle className="text-[19px] font-semibold tracking-[-0.02em]">Can&apos;t authorize this app</CardTitle>
        <CardDescription>{message}</CardDescription>
      </CardHeader>
    </Card>
  );
}

/**
 * Better Auth sends people here (with a signed query) when an OAuth client —
 * an MCP client such as Claude or Cursor — asks for access.
 */
export default async function ConsentPage({ searchParams }: PageProps<"/oauth/consent">) {
  const params = await searchParams;
  const query = oauthQuery(params);
  const { secret } = await auth.$context;
  if (!query || !(await verifyOAuthQueryParams(query, secret))) {
    return <Problem message="This authorization link is invalid or has expired. Start connecting again from the app." />;
  }

  const session = await getSession();
  if (!session) redirect(`/login?${query}`);

  const clientId = typeof params.client_id === "string" ? params.client_id : "";
  let client: PublicClient | null = null;
  try {
    client = (await auth.api.getOAuthClientPublic({
      query: { client_id: clientId },
      headers: await headers(),
    })) as PublicClient;
  } catch {
    client = null;
  }
  if (!client) return <Problem message="This app isn't registered." />;

  const redirectHost = hostOf(typeof params.redirect_uri === "string" ? params.redirect_uri : null);
  return (
    <ConsentForm
      app={{
        name: client.client_name || hostOf(client.client_uri) || "An app",
        site: hostOf(client.client_uri),
        logo: client.logo_uri?.startsWith("https://") ? client.logo_uri : null,
      }}
      account={{ name: session.user.name, email: session.user.email }}
      scopes={describeScopes(typeof params.scope === "string" ? params.scope : "")}
      redirectHost={redirectHost}
    />
  );
}
