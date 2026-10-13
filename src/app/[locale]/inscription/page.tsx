import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AuthShell } from "@/components/auth/auth-shell";
import { Link } from "@/i18n/navigation";
import { SignUpForm } from "./sign-up-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth");
  return { title: t("signUpTitle") };
}

export default async function InscriptionPage({ params }: { params: Promise<{ locale: "fr" }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Auth");

  return (
    <AuthShell
      title={t("signUpTitle")}
      description={t("signUpSubtitle")}
      footer={
        <>
          {t("haveAccount")}{" "}
          <Link href="/connexion" className="font-medium text-foreground underline-offset-4 hover:underline">
            {t("signInLink")}
          </Link>
        </>
      }
    >
      <SignUpForm />
    </AuthShell>
  );
}
