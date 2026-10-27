import { redirect } from "next/navigation";

export default async function SettingsPage({ params }: PageProps<"/[workspace]/settings">) {
  const { workspace } = await params;
  redirect(`/${workspace}/settings/members`);
}
