import { SettingsSkeleton } from "@/components/loading/skeletons";

// Inside the settings layout, so the header and tabs stay while a tab loads.
export default function Loading() {
  return <SettingsSkeleton />;
}
