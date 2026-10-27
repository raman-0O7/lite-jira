/**
 * Outgoing email. Sends through Resend's HTTP API when RESEND_API_KEY and
 * EMAIL_FROM are set; otherwise logs the message so local setups still work
 * (every invite also returns its link to the inviter).
 */

type Email = { to: string; subject: string; text: string; html: string };

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Send an email; resolves to whether it was handed to a provider. Never throws. */
export async function sendEmail(email: Email): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    if (process.env.NODE_ENV !== "test") {
      console.info(`[email] Not sent (no provider configured) → ${email.to}\n${email.text}`);
    }
    return false;
  }
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...email, from, to: [email.to] }),
    });
    if (!response.ok) {
      console.error(`[email] Resend returned ${response.status}: ${await response.text()}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error("[email] Send failed", error);
    return false;
  }
}

export function sendInviteEmail(invite: {
  to: string;
  workspaceName: string;
  inviterName: string | null;
  url: string;
}) {
  const who = invite.inviterName ? `${invite.inviterName} invited you` : "You're invited";
  const line = `${who} to join ${invite.workspaceName} on Kanso.`;
  return sendEmail({
    to: invite.to,
    subject: `Join ${invite.workspaceName} on Kanso`,
    text: `${line}\n\nAccept the invite: ${invite.url}\n\nThe link expires in 7 days.`,
    html: `<p>${escapeHtml(line)}</p><p><a href="${escapeHtml(invite.url)}">Accept the invite</a></p><p>The link expires in 7 days.</p>`,
  });
}
