import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Logo } from "@/components/brand/logo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { SignInForm } from "./sign-in-form";

// Reads ?redirectTo= at request time.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth");
  return { title: t("signInTitle") };
}

export default async function ConnexionPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: "fr" }>;
  searchParams: Promise<{ redirectTo?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { redirectTo } = await searchParams;
  const t = await getTranslations("Auth");
  const tLanding = await getTranslations("Landing.nav");

  return (
    <main className="relative isolate flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[36rem] bg-glow" />

      <Link href="/" aria-label={tLanding("home")} className="mb-8 rounded-full">
        <Logo />
      </Link>
      <Card className="surface-card w-full max-w-sm shadow-xl motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-700 motion-safe:ease-out-expo">
        <CardHeader>
          <CardTitle className="text-h2">{t("signInTitle")}</CardTitle>
          <CardDescription>{t("signInSubtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <SignInForm redirectTo={redirectTo} />
        </CardContent>
      </Card>
      <Link
        href="/"
        className="mt-6 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t("backHome")}
      </Link>
    </main>
  );
}
