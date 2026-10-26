import type { Metadata } from "next";

import { MembersSettings } from "@/components/workspace/MembersSettings";

export const metadata: Metadata = { title: "Members · Kanso" };

export default function MembersPage() {
  return <MembersSettings />;
}
