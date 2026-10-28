import { AppShellSkeleton } from "@/components/loading/skeletons";

// Shown while a workspace's layout loads (opening the app, switching workspace).
export default function Loading() {
  return <AppShellSkeleton />;
}
