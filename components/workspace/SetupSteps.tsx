"use client";

import { ChevronRight, Copy } from "lucide-react";
import { Fragment } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

/**
 * Building blocks for step-by-step setup instructions (docs/features/13-guided-setup.md):
 * the numbered rail, and buttons or values in another app drawn the way they look there.
 */

/** A button, tab or field in another app (Claude, ChatGPT…), drawn the way it looks there. */
export function Ui({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border bg-background px-1.5 py-px text-xs font-medium whitespace-nowrap text-foreground shadow-xs">
      {children}
    </span>
  );
}

/** Something the person types or picks, rather than clicks. */
export function Value({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-dashed px-1.5 py-px text-xs whitespace-nowrap text-muted-foreground">
      {children}
    </span>
  );
}

/** Clicks in order: strings are buttons or tabs, nodes are drawn as given. */
export function Path({ items }: { items: React.ReactNode[] }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      {items.map((item, i) => (
        <Fragment key={i}>
          {i > 0 ? <ChevronRight className="size-3 text-muted-foreground" aria-hidden /> : null}
          {typeof item === "string" ? <Ui>{item}</Ui> : item}
        </Fragment>
      ))}
    </span>
  );
}

/** A numbered step on a vertical rail. */
export function StepRow({
  number,
  title,
  last,
  children,
}: {
  number: number;
  title: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {last ? null : <span className="absolute top-7 bottom-1 left-3 w-px bg-border" aria-hidden />}
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-chip text-xs font-medium text-muted-foreground">
        {number}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5">
        <p className="font-medium">{title}</p>
        {children}
      </div>
    </li>
  );
}

export async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied.`);
  } catch {
    toast.error("Couldn’t copy. Select the text and copy it yourself.");
  }
}

export function Snippet({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex items-start gap-2">
        <pre className="min-w-0 flex-1 overflow-x-auto rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs">
          {text}
        </pre>
        <Button variant="outline" size="icon-sm" aria-label={`Copy ${label}`} onClick={() => copy(text, label)}>
          <Copy />
        </Button>
      </div>
    </div>
  );
}
