import { NextResponse } from "next/server";

import { reconcileActiveRuns } from "@/lib/agents/claude-api";
import { failStaleRuns } from "@/lib/agents/lifecycle";
import { safeEqual } from "@/lib/crypto";

// GET /api/cron/agent-watchdog (Authorization: Bearer $CRON_SECRET) → fail runs nobody claimed, sync workspace-agent sessions.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const presented = request.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(presented, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const failed = await failStaleRuns();
  return NextResponse.json({ failed, synced: await reconcileActiveRuns() });
}
