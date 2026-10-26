import Link from "next/link";

import { KansoMark } from "@/components/icons/KansoMark";

export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-7 px-4 py-10">
      <Link href="/" className="flex flex-col items-center gap-3 text-center">
        <KansoMark className="size-9 rounded-[10px]" />
        <span className="font-heading text-[19px] font-semibold tracking-[-0.02em] text-foreground">Kanso</span>
      </Link>
      {children}
      <p className="max-w-xs text-center text-xs text-muted-foreground">
        Issue tracking for teams and the AI agents that work with them.
      </p>
    </main>
  );
}
