import { NextResponse } from "next/server";

import { ZodError } from "zod";

import { getSession } from "@/lib/auth";
import { verifyState } from "@/lib/crypto";
import { db } from "@/lib/db";
import { ServiceError } from "@/lib/services/errors";
import { completeGitHubCallback } from "@/lib/services/github";

/** Settings → Integrations of the workspace, else of the user's first workspace. */
async function integrationsPath(userId: string, workspaceId: string | undefined) {
  const membership = await db.membership.findFirst({
    where: { userId, ...(workspaceId ? { workspaceId } : {}) },
    orderBy: { createdAt: "asc" },
    select: { workspace: { select: { slug: true } } },
  });
  return membership ? `/${membership.workspace.slug}/settings/integrations` : "/projects";
}

// GET /api/github/callback — GitHub's redirect after installing the app or authorizing a user link.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const session = await getSession();
  if (!session) {
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(url.pathname + url.search)}`, url));
  }

  const params = url.searchParams;
  try {
    const { workspaceId, result } = await completeGitHubCallback(session.user.id, {
      code: params.get("code"),
      state: params.get("state"),
      installationId: params.get("installation_id"),
      setupAction: params.get("setup_action"),
    });
    return NextResponse.redirect(new URL(`${await integrationsPath(session.user.id, workspaceId)}?github=${result}`, url));
  } catch (error) {
    const message =
      error instanceof ServiceError
        ? error.message
        : error instanceof ZodError
          ? "GitHub sent an unexpected response"
          : "Could not connect GitHub";
    if (!(error instanceof ServiceError) && !(error instanceof ZodError)) console.error("[github.callback]", error);
    const state = verifyState<{ workspaceId?: string }>(params.get("state") ?? "");
    const path = await integrationsPath(session.user.id, state?.workspaceId);
    return NextResponse.redirect(new URL(`${path}?github_error=${encodeURIComponent(message)}`, url));
  }
}
