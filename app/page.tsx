import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">Lite Jira</h1>
      <p className="text-muted-foreground">
        A solo, self-hosted Kanban task manager.
      </p>
      <Link href="/boards" className={buttonVariants()}>
        Go to boards
      </Link>
    </main>
  );
}
