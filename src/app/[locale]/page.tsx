import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CallToAction } from "@/components/landing/call-to-action";
import { Faq } from "@/components/landing/faq";
import { FeatureCards } from "@/components/landing/feature-cards";
import { FormatStrip } from "@/components/landing/format-strip";
import { Hero } from "@/components/landing/hero";
import { ProgressShowcase } from "@/components/landing/progress-showcase";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteHeader } from "@/components/landing/site-header";
import { WorkspaceBento } from "@/components/landing/workspace-bento";
import { prelaunchUntil } from "@/lib/launch";

// Public landing page. It reads no cookies or search params, so it is
// prerendered at build time. Signed-in visitors are sent to the dashboard by
// the proxy before they reach it.
//
// A production build from before the launch shows a countdown in the hero
// (KRB-239). The hero switches to its buttons by itself at the launch. No
// revalidate: with it, `next start` answers with stale-while-revalidate, and
// the browser's background check of the page never lets the network go idle
// in the e2e and smoke tests.

export async function generateMetadata({ params }: { params: Promise<{ locale: "fr" }> }): Promise<Metadata> {
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

export default async function LandingPage({ params }: { params: Promise<{ locale: "fr" }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Landing");

  return (
    <div className="relative isolate">
      <noscript>
        <style>{NO_SCRIPT_REVEAL}</style>
      </noscript>
      {/* Warm light behind the header and hero, in both themes. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[52rem] bg-glow [mask-image:linear-gradient(to_bottom,#000_55%,transparent)]"
      />
      <a
        href="#contenu"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-full focus:bg-foreground focus:px-4 focus:py-2 focus:text-sm focus:text-background"
      >
        {t("skipToContent")}
      </a>
      <SiteHeader />
      <main id="contenu" className="overflow-x-clip">
        <Hero launchAt={prelaunchUntil()} />
        <FormatStrip />
        <FeatureCards />
        <ProgressShowcase />
        <WorkspaceBento />
        <Faq />
        <CallToAction />
      </main>
      <SiteFooter />
    </div>
  );
}
