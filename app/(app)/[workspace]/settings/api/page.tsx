import type { Metadata } from "next";

import { ApiSettings } from "@/components/workspace/ApiSettings";
import { MCP_RESOURCE } from "@/lib/mcp/config";

export const metadata: Metadata = { title: "API & MCP" };

export default function ApiSettingsPage() {
  return <ApiSettings mcpUrl={MCP_RESOURCE} />;
}
