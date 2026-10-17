import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { GuidePage, guideMetadata } from "@/components/guide/guide-page";
import type { Locale } from "@/i18n/routing";

// The user guide (KRB-199). Public and prerendered at build time, like the
// legal pages: signed-in users read it too.
type Props = { params: Promise<{ locale: Locale }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  return guideMetadata(locale);
}

export default async function GuideRoute({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <GuidePage locale={locale} />;
}
