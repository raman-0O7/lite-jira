import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type AuthCardProps = {
  title: string;
  description: string;
  children: React.ReactNode;
  footerPrompt: string;
  footerLinkLabel: string;
  footerLinkHref: string;
};

export function AuthCard({
  title,
  description,
  children,
  footerPrompt,
  footerLinkLabel,
  footerLinkHref,
}: AuthCardProps) {
  return (
    <Card className="w-full max-w-sm bg-background shadow-panel [--card-spacing:--spacing(6)]">
      <CardHeader>
        <CardTitle as="h1" className="text-[19px] font-semibold tracking-[-0.02em]">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
      <CardFooter className="justify-center border-t bg-transparent py-4">
        <p className="text-sm text-muted-foreground">
          {footerPrompt}{" "}
          <Link
            href={footerLinkHref}
            className="font-medium text-primary-text underline-offset-4 hover:underline"
          >
            {footerLinkLabel}
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
