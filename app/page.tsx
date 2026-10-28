import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth";

// No landing page: signed-in people go to their projects, everyone else to sign in.
export default async function Home() {
  redirect((await getSession()) ? "/projects" : "/login");
}
