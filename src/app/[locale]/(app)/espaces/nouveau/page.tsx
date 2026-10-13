import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { WorkspaceWizard } from "./workspace-wizard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("WorkspaceWizard");
  return { title: t("metaTitle") };
}

export default async function NewWorkspacePage({ params }: { params: Promise<{ locale: "fr" }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("WorkspaceWizard");

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 lg:py-12 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-500">
      <header>
        <h1 className="text-h2 text-foreground">{t("title")}</h1>
        <p className="mt-1 text-small text-muted-foreground">{t("subtitle")}</p>
      </header>
      <WorkspaceWizard />
    </div>
  );
}
