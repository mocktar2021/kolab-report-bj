import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">{t("signInTitle")}</CardTitle>
          <CardDescription>{t("signInSubtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <SignInForm redirectTo={redirectTo} />
        </CardContent>
      </Card>
    </main>
  );
}
