import { type ClaudeCodeConfig, FIRE_URL_PATTERN } from "@/lib/agents/config";
import { agentFetch, DispatchError } from "@/lib/agents/http";

/**
 * Claude Code routines "fire" API (research preview). Isolated here because it
 * sits behind a dated beta header and may change.
 *
 * POST {fireUrl} with the routine's token and {text}; 200 →
 * {type: "routine_fire", claude_code_session_id, claude_code_session_url}.
 * Fires aren't idempotent, so callers never retry automatically.
 */
export const ROUTINE_BETA = "experimental-cc-routine-2026-04-01";

export async function fireRoutine(config: ClaudeCodeConfig, text: string) {
  if (!FIRE_URL_PATTERN.test(config.fireUrl)) throw new DispatchError("Invalid routine fire URL");
  let response: Response;
  try {
    response = await agentFetch(config.fireUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": ROUTINE_BETA,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: text.slice(0, 65_536) }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new DispatchError("Couldn't reach the Claude Code routines API");
  }

  const data = (await response.json().catch(() => ({}))) as {
    claude_code_session_id?: string;
    claude_code_session_url?: string;
    error?: { type?: string; message?: string };
  };
  if (!response.ok) {
    const reason = data.error?.message ?? response.statusText ?? "request failed";
    const retryAfter = response.headers.get("retry-after");
    const hint =
      response.status === 401 || response.status === 403
        ? " Check the routine token in Settings → Agents."
        : response.status === 429 && retryAfter
          ? ` Try again in ${retryAfter}s.`
          : "";
    throw new DispatchError(`Claude Code routine fire failed (${response.status}): ${reason}.${hint}`.slice(0, 500));
  }
  if (!data.claude_code_session_id) throw new DispatchError("Claude Code didn't return a session");
  return { sessionId: data.claude_code_session_id, sessionUrl: data.claude_code_session_url ?? null };
}
