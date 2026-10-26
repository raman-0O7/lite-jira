import { ProjectList } from "@/components/project/ProjectList";

export const metadata = { title: "Projects" };

// The [workspace] layout has already checked membership.
export default function ProjectsPage() {
  return <ProjectList />;
}
