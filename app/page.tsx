import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { KansoMark } from "@/components/icons/KansoMark";
import { Kbd } from "@/components/icons/Kbd";
import { buttonVariants } from "@/components/ui/button";
import { getSession } from "@/lib/auth";
import { cn } from "@/lib/utils";

const POINTS = [
  { title: "Board and list", body: "Drag issues across columns, or scan them as a dense list." },
  { title: "Keyboard first", body: "Jump anywhere with ⌘K; C creates, / filters, G P goes to projects." },
  { title: "Built for agents", body: "Every change is recorded, so people and agents share one history." },
];

export default async function Home() {
  const session = await getSession();
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-16">
      <div className="flex w-full max-w-2xl flex-col items-center gap-6 text-center">
        <KansoMark className="size-11 rounded-xl" />
        <h1 className="font-heading text-[34px] leading-tight font-semibold tracking-[-0.03em] text-foreground sm:text-[44px]">
          Calm issue tracking
        </h1>
        <p className="max-w-md text-[15px] leading-relaxed text-muted-foreground">
          Kanso is issue tracking for teams and the AI agents that work with them: fast, dense, and
          quiet.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Link href="/projects" className={cn(buttonVariants({ size: "lg" }), "gap-2")}>
            {session ? "Open your projects" : "Get started"}
            <ArrowRight />
          </Link>
          {session ? null : (
            <Link href="/login" className={buttonVariants({ size: "lg", variant: "outline" })}>
              Sign in
            </Link>
          )}
        </div>
        <ul className="mt-8 grid w-full gap-3 text-left sm:grid-cols-3">
          {POINTS.map((point) => (
            <li key={point.title} className="rounded-xl border bg-background p-4 shadow-card">
              <p className="text-sm font-semibold text-foreground">{point.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{point.body}</p>
            </li>
          ))}
        </ul>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Press <Kbd>?</Kbd> inside the app for every shortcut.
        </p>
      </div>
    </main>
  );
}
