import { getTranslations } from "next-intl/server";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteHeader } from "@/components/landing/site-header";
import { WebAnalytics } from "@/components/monitoring/web-analytics";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";

/**
 * Frame of the long public pages, the legal pages and the user guide: the
 * glow, the skip link, the landing header and footer around the content.
 * The header and footer link to sections of the landing page. In print, only
 * the content is left.
 */
export async function PublicPageShell({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const tLanding = await getTranslations({ locale, namespace: "Landing" });
  const landing = getPathname({ href: "/", locale });

  return (
    <div className="relative isolate">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[32rem] bg-glow [mask-image:linear-gradient(to_bottom,#000_40%,transparent)] print:hidden"
      />
      <a
        href="#contenu"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-full focus:bg-foreground focus:px-4 focus:py-2 focus:text-sm focus:text-background"
      >
        {tLanding("skipToContent")}
      </a>
      <SiteHeader sectionBase={landing} />
      <main
        id="contenu"
        className="mx-auto max-w-6xl px-4 pb-24 pt-10 sm:px-6 sm:pt-16 print:max-w-none print:px-0 print:pb-0 print:pt-0"
      >
        {children}
      </main>
      <SiteFooter sectionBase={landing} />
      <WebAnalytics />
    </div>
  );
}
