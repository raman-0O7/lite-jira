"use client";

import { useQuery } from "@tanstack/react-query";

import { useWorkspace } from "@/components/providers/workspace-provider";
import { aiKeys, fetchAi } from "@/lib/api/ai";

/** The workspace's AI status (shared cache for every AI button). */
export function useAiStatus() {
  const { slug } = useWorkspace();
  return useQuery({ queryKey: aiKeys.status(slug), queryFn: () => fetchAi(slug), staleTime: 5 * 60_000 });
}

/** Whether to show AI actions: AI is on and this person may use it. */
export function useCanUseAi() {
  return useAiStatus().data?.ai.canUse ?? false;
}
