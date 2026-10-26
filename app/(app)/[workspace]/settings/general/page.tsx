import type { Metadata } from "next";

import { GeneralSettings } from "@/components/workspace/GeneralSettings";

export const metadata: Metadata = { title: "Settings · Kanso" };

export default function GeneralSettingsPage() {
  return <GeneralSettings />;
}
