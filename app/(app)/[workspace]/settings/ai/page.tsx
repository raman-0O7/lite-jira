import type { Metadata } from "next";

import { AiSettings } from "@/components/workspace/AiSettings";

export const metadata: Metadata = { title: "AI" };

export default function AiSettingsPage() {
  return <AiSettings />;
}
