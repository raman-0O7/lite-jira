import { NextResponse } from "next/server";

import { failStaleRuns } from "@/lib/agents/lifecycle";
import { safeEqual } from "@/lib/crypto";

// GET /api/cron/agent-watchdog (Authorization: Bearer $CRON_SECRET) → fail runs nobody claimed.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const presented = request.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(presented, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ failed: await failStaleRuns() });
}
