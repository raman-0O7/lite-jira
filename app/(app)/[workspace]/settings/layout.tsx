import { PageHeader, PageTitle } from "@/components/app-shell/PageHeader";
import { SettingsNav } from "@/components/workspace/SettingsNav";

export default async function SettingsLayout({
  children,
  params,
}: LayoutProps<"/[workspace]/settings">) {
  const { workspace } = await params;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader>
        <PageTitle>Settings</PageTitle>
        <SettingsNav slug={workspace} />
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">{children}</div>
      </div>
    </div>
  );
}
