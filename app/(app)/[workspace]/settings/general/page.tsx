import type { Metadata } from "next";

import { GeneralSettings } from "@/components/workspace/GeneralSettings";

export const metadata: Metadata = { title: "General settings" };

export default function GeneralSettingsPage() {
  return <GeneralSettings />;
}
