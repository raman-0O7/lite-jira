import { QueryProvider } from "@/components/providers/query-provider";
import { requireUser } from "@/lib/auth";

/**
 * Protected app shell. Every route under app/(app)/* renders inside this.
 *
 * Route protection lives here (server-side) rather than in middleware:
 * Better Auth validates the session against the database via getSession(),
 * which is reliable in a Server Component but not in Next's middleware
 * runtime. requireUser() redirects unauthenticated visitors to /login.
 *
 * The top bar is rendered by app/(app)/[workspace]/layout.tsx, which knows the
 * current workspace.
 */
export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await requireUser();

  return (
    <QueryProvider>
      <div className="flex min-h-full flex-1 flex-col">{children}</div>
    </QueryProvider>
  );
}
