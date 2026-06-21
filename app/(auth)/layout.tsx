export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Lite Jira</h1>
        <p className="text-sm text-muted-foreground">
          A solo, self-hosted Kanban task manager.
        </p>
      </div>
      {children}
    </main>
  );
}
