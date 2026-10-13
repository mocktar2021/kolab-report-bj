import { redirect } from "@/i18n/navigation";

export default async function LocaleHome({
  params,
}: {
  params: Promise<{ locale: "fr" }>;
}) {
  const { locale } = await params;
  // Unauthenticated users are sent to /fr/connexion by the middleware.
  redirect({ href: "/tableau-de-bord", locale });
}
