import type { Metadata } from "next";

import { AgentsSettings } from "@/components/workspace/AgentsSettings";
import { MCP_RESOURCE } from "@/lib/mcp/config";

export const metadata: Metadata = { title: "Agents" };

export default function AgentsSettingsPage() {
  return <AgentsSettings mcpUrl={MCP_RESOURCE} />;
}
