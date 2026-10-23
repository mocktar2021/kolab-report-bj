import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AuthShell } from "@/components/auth/auth-shell";
import { LaunchPanel } from "@/components/launch/launch-panel";
import { UntilLaunch } from "@/components/launch/until-launch";
import { Link } from "@/i18n/navigation";
import { emailSchema } from "@/lib/auth/schemas";
import { prelaunchUntil } from "@/lib/launch";
import { SignUpForm } from "./sign-up-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth");
  return { title: t("signUpTitle") };
}

export default async function InscriptionPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: "fr" }>;
  searchParams: Promise<{ email?: string | string[] }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Auth");
  // ?email= comes from an invitation link: the address is filled in for them.
  const { email } = await searchParams;
  const invitedEmail = emailSchema.safeParse(email);
  const form = <SignUpForm defaultEmail={invitedEmail.success ? invitedEmail.data : ""} />;

  // Before the launch, production shows the countdown and the reminder form
  // instead (KRB-239). The form takes their place at the launch second, and
  // the sign-up action refuses anything sent earlier.
  const launchAt = prelaunchUntil();
  const tLaunch = await getTranslations("Launch");

  return (
    <AuthShell
      title={t("signUpTitle")}
      description={
        launchAt ? (
          <UntilLaunch until={launchAt} before={tLaunch("signUpClosed")}>
            {t("signUpSubtitle")}
          </UntilLaunch>
        ) : (
          t("signUpSubtitle")
        )
      }
      footer={
        <>
          {t("haveAccount")}{" "}
          <Link href="/connexion" className="font-medium text-foreground underline-offset-4 hover:underline">
            {t("signInLink")}
          </Link>
        </>
      }
    >
      {launchAt ? (
        <UntilLaunch until={launchAt} before={<LaunchPanel until={launchAt} />}>
          {form}
        </UntilLaunch>
      ) : (
        form
      )}
    </AuthShell>
  );
}
