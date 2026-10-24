export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Kanso</h1>
        <p className="text-sm text-muted-foreground">
          Issue tracking for teams and the AI agents that work with them.
        </p>
      </div>
      {children}
    </main>
  );
}
