import type { Metadata } from "next";
import { Suspense } from "react";

import { IntegrationsSettings } from "@/components/workspace/IntegrationsSettings";

export const metadata: Metadata = { title: "Integrations" };

export default function IntegrationsSettingsPage() {
  return (
    <Suspense>
      <IntegrationsSettings />
    </Suspense>
  );
}
