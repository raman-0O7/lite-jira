import { SettingsNav } from "@/components/workspace/SettingsNav";

export default async function SettingsLayout({
  children,
  params,
}: LayoutProps<"/[workspace]/settings">) {
  const { workspace } = await params;
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <SettingsNav slug={workspace} />
      {children}
    </main>
  );
}
