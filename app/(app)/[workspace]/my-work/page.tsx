import { MyWorkView } from "@/components/work/MyWorkView";

export const metadata = { title: "My work" };

// The [workspace] layout has already checked membership.
export default function MyWorkPage() {
  return <MyWorkView />;
}
