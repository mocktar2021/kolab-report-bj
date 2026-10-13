import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { ResetPasswordForm } from "./reset-password-form";

// Depends on the session set by the recovery link.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth");
  return { title: t("resetTitle") };
}

export default async function ReinitialiserMotDePassePage({ params }: { params: Promise<{ locale: "fr" }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Auth");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <AuthShell title={t("resetExpiredTitle")} description={t("resetExpiredBody")}>
        <Button asChild shape="pill" className="h-10 w-full">
          <Link href="/mot-de-passe-oublie">{t("resetExpiredCta")}</Link>
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t("resetTitle")} description={t("resetSubtitle")}>
      <ResetPasswordForm email={user.email ?? ""} />
    </AuthShell>
  );
}
