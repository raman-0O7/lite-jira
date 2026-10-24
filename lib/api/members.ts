import { request } from "@/lib/api/http";

export type Member = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: "OWNER" | "ADMIN" | "MEMBER" | "GUEST";
};

export const memberKeys = {
  list: (workspaceSlug: string) => ["members", workspaceSlug] as const,
};

export async function fetchMembers(workspaceSlug: string) {
  const data = await request<{ members: Member[] }>(
    `/api/workspaces/${workspaceSlug}/members`,
    "Failed to load members",
  );
  return data.members;
}
