import { requireUser } from "@/lib/auth";

export default async function BoardsPage() {
  const user = await requireUser();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <h1 className="text-2xl font-semibold">Boards</h1>
      <p className="text-muted-foreground">
        Placeholder protected page (Feature 00). Board UI lands in later
        features.
      </p>
      <p className="text-sm">
        Signed in as <span className="font-medium">{user.email}</span>
      </p>
    </main>
  );
}
