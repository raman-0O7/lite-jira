import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { defaultWorkspaceSlug } from "@/lib/services/workspaces";

// Post-login landing: send the user to their default workspace (creating the
// personal workspace first if they somehow have none).
export default async function ProjectsRedirect() {
  const user = await requireUser();
  redirect(`/${await defaultWorkspaceSlug(user)}/projects`);
}
