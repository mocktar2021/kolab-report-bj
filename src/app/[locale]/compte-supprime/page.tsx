import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AuthShell } from "@/components/auth/auth-shell";
import { ClearOfflineCaches } from "./clear-offline-caches";

// Where a deleted account lands, signed out (KRB-186). Public: the proxy
// lists it, since the session is gone by the time the browser gets here.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Account.deleted");
  return { title: t("metaTitle"), robots: { index: false } };
}

export default async function CompteSupprimePage({ params }: { params: Promise<{ locale: "fr" }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Account.deleted");

  return (
    <AuthShell title={t("title")} description={t("description")}>
      <p className="text-sm text-muted-foreground">{t("kept")}</p>
      <ClearOfflineCaches />
    </AuthShell>
  );
}
