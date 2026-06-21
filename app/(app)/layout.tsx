import { TopBar } from "@/components/app-shell/top-bar";
import { requireUser } from "@/lib/auth";

/**
 * Protected app shell. Every route under app/(app)/* renders inside this.
 *
 * Route protection lives here (server-side) rather than in middleware:
 * Better Auth validates the session against the database via getSession(),
 * which is reliable in a Server Component but not in Next's middleware
 * runtime. requireUser() redirects unauthenticated visitors to /login.
 *
 * Feature 02/03 render their pages as {children}; they should not duplicate
 * the auth guard or the top bar.
 */
export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await requireUser();

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <TopBar
        user={{ name: user.name, email: user.email, image: user.image }}
      />
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
