import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Button } from "@/components/ui/button";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Offline");
  return { title: t("title") };
}

// Precached by the service worker and served as the document fallback.
export const dynamic = "force-static";

export default async function HorsLignePage({
  params,
}: {
  params: Promise<{ locale: "fr" }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Offline");

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="max-w-md text-muted-foreground">{t("description")}</p>
      <Button asChild>
        {/* Full page load on purpose: retries the network instead of a client-side transition. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/fr/tableau-de-bord">{t("retry")}</a>
      </Button>
    </main>
  );
}
