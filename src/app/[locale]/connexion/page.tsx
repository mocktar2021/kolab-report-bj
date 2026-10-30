import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AuthShell } from "@/components/auth/auth-shell";
import { Link } from "@/i18n/navigation";
import { publicPageMetadata } from "@/lib/seo/metadata";
import { SignInForm } from "./sign-in-form";

// Reads ?next= and ?erreur= at request time.
export const dynamic = "force-dynamic";

// The canonical address drops ?next= and ?erreur=, so search engines keep one page.
export async function generateMetadata({ params }: { params: Promise<{ locale: "fr" }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Auth" });
  return publicPageMetadata({
    locale,
    path: "/connexion",
    title: t("signInTitle"),
    description: t("signInMetaDescription"),
  });
}

export default async function ConnexionPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: "fr" }>;
  searchParams: Promise<{ next?: string; erreur?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { next, erreur } = await searchParams;
  const t = await getTranslations("Auth");

  return (
    <AuthShell
      title={t("signInTitle")}
      description={t("signInSubtitle")}
      footer={
        <>
          {t("noAccount")}{" "}
          <Link
            href="/inscription"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            {t("register")}
          </Link>
        </>
      }
    >
      {erreur === "lien-invalide" ? (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {t("linkInvalid")}
        </p>
      ) : null}
      <SignInForm next={next} />
    </AuthShell>
  );
}
