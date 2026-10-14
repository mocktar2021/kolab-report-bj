import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Logo } from "@/components/brand/logo";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";

/** Shared frame for the sign-in, sign-up and password pages. */
export async function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const t = await getTranslations("Auth");
  const tNav = await getTranslations("Landing.nav");

  return (
    <main className="relative isolate flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[36rem] bg-glow"
      />

      <Link href="/" aria-label={tNav("home")} className="mb-8 rounded-full">
        <Logo />
      </Link>
      {/*
        The fade starts at half opacity: from zero, Chrome only counted the card
        as largest contentful paint after hydration (KRB-154).
      */}
      <Card className="surface-card w-full max-w-sm shadow-xl motion-safe:animate-in motion-safe:fade-in-50 motion-safe:slide-in-from-bottom-2 motion-safe:duration-700 motion-safe:ease-out-expo">
        <CardHeader>
          {/* The card title is the page heading. */}
          <h1 className="font-display text-h2">{title}</h1>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
      {footer ? <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div> : null}
      <Link
        href="/"
        className="mt-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t("backHome")}
      </Link>
    </main>
  );
}
