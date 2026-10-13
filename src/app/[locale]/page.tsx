import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CallToAction } from "@/components/landing/call-to-action";
import { Facts } from "@/components/landing/facts";
import { Faq } from "@/components/landing/faq";
import { FeatureBento } from "@/components/landing/feature-bento";
import { Hero } from "@/components/landing/hero";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteHeader } from "@/components/landing/site-header";

// Public landing page. It reads no cookies or search params, so it is
// prerendered at build time. Signed-in visitors are sent to the dashboard by
// the middleware before they reach it.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: "fr" }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Landing" });
  return {
    title: { absolute: t("metaTitle") },
    description: t("metaDescription"),
  };
}

// Content revealed by motion starts transparent in the server HTML. Without
// JavaScript it would stay hidden, so this rule shows it.
const NO_SCRIPT_REVEAL = "[data-reveal]{opacity:1!important;transform:none!important}";

export default async function LandingPage({
  params,
}: {
  params: Promise<{ locale: "fr" }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Landing");

  return (
    <>
      <noscript>
        <style>{NO_SCRIPT_REVEAL}</style>
      </noscript>
      <a
        href="#contenu"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-full focus:bg-foreground focus:px-4 focus:py-2 focus:text-sm focus:text-background"
      >
        {t("skipToContent")}
      </a>
      <SiteHeader />
      <main id="contenu" className="overflow-x-clip">
        <Hero />
        <FeatureBento />
        <Facts />
        <Faq />
        <CallToAction />
      </main>
      <SiteFooter />
    </>
  );
}
