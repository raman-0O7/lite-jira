import { NextResponse } from "next/server";

import { safeEqual } from "@/lib/crypto";
import { githubConfigured } from "@/lib/github/config";
import { syncAllRepos } from "@/lib/services/github";

// GET /api/cron/github-sync (Authorization: Bearer $CRON_SECRET) → catch every connected repo up with GitHub.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const presented = request.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(presented, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!githubConfigured()) return NextResponse.json({ repos: 0, imported: 0, updated: 0, failed: 0 });
  return NextResponse.json(await syncAllRepos());
}
