import type { Metadata, Viewport } from "next";
import { Instrument_Sans, Inter_Tight } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { MotionProvider } from "@/components/motion/motion-provider";
import { UpdateBanner } from "@/components/pwa/update-banner";
import { THEME_COLORS } from "@/components/theme/theme-config";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { routing } from "@/i18n/routing";
import "../globals.css";

// Inter Tight for body text and UI, Instrument Sans for headings and large
// numbers (font-display). Both are variable fonts, so one file each.
const interTight = Inter_Tight({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: "Metadata",
  });

  return {
    metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
    title: { default: t("title"), template: t("titleTemplate") },
    description: t("description"),
    applicationName: "KolabReport",
    manifest: "/manifest.webmanifest",
    appleWebApp: { capable: true, title: "KolabReport", statusBarStyle: "default" },
    formatDetection: { telephone: false },
    // Drawn from the logo mark by scripts/generate-icons.mjs. Browsers that
    // read SVG take icon.svg, which follows the device's light or dark mode.
    icons: {
      icon: [
        { url: "/favicon.ico", sizes: "32x32" },
        { url: "/icons/icon.svg", type: "image/svg+xml" },
      ],
      apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
    },
    alternates: { languages: { fr: "/fr" } },
    openGraph: { locale: "fr_FR", siteName: "KolabReport", type: "website" },
  };
}

// Follows the device setting. ThemeProvider rewrites both tags when the
// visitor picks a theme by hand.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  return (
    <html
      lang={locale}
      className={`${interTight.variable} ${instrumentSans.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-dvh">
        <ThemeProvider>
          <NextIntlClientProvider>
            <MotionProvider>{children}</MotionProvider>
            <UpdateBanner />
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
