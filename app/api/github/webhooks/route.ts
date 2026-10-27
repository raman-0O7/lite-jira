import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { githubAppConfig } from "@/lib/github/config";
import { verifyWebhookSignature } from "@/lib/github/signature";
import { HANDLED_EVENTS, handleGitHubWebhook } from "@/lib/github/webhooks";
import { isUniqueViolation } from "@/lib/services/github";

// POST /api/github/webhooks — GitHub App deliveries (docs/features/11-github-app.md "Webhooks").
export async function POST(request: Request) {
  const config = githubAppConfig();
  if (!config) return NextResponse.json({ error: "GitHub App not configured" }, { status: 404 });

  const raw = await request.text();
  if (!verifyWebhookSignature(config.webhookSecret, raw, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
  const event = request.headers.get("x-github-event");
  const delivery = request.headers.get("x-github-delivery");
  if (!event || !delivery) return NextResponse.json({ error: "Missing delivery headers" }, { status: 400 });
  if (!HANDLED_EVENTS.has(event)) return NextResponse.json({ ignored: event }, { status: 202 });

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    await db.gitHubDelivery.create({ data: { id: delivery.slice(0, 100), event } });
  } catch (error) {
    if (isUniqueViolation(error)) return NextResponse.json({ duplicate: true });
    throw error;
  }

  try {
    await handleGitHubWebhook(event, payload);
  } catch (error) {
    // Let GitHub's redelivery try again.
    await db.gitHubDelivery.delete({ where: { id: delivery.slice(0, 100) } }).catch(() => {});
    console.error("[github.webhook]", event, error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Webhook handling failed" }, { status: 500 });
  }

  // Keep the dedupe table small: drop deliveries older than a week now and then.
  if (Math.random() < 0.02) {
    await db.gitHubDelivery.deleteMany({ where: { receivedAt: { lt: new Date(Date.now() - 7 * 86_400_000) } } });
  }
  return NextResponse.json({ ok: true });
}
