import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { localizedPath } from "./site";

/** The preview image of every public page, drawn by scripts/generate-og-image.mjs. */
export const SHARE_IMAGE = { url: "/og/kolabreport.png", width: 1200, height: 630 } as const;

type PublicPageMetadata = {
  locale: Locale;
  /** Path without the locale prefix: "/" for the home page, "/tarifs", ... */
  path: string;
  /** The page title. `absolute` skips the "· KolabReport" ending. */
  title: string | { absolute: string };
  description: string;
};

/**
 * Metadata for a page anyone can read (KRB-258): its canonical address, and
 * the title, description and image that search engines and the apps a link is
 * shared in (WhatsApp, LinkedIn, Facebook, X) show. A page's openGraph and
 * alternates replace the layout's whole, so this sets every field.
 */
export async function publicPageMetadata({
  locale,
  path,
  title,
  description,
}: PublicPageMetadata): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: "Metadata" });
  const url = localizedPath(path, locale);
  const fullTitle = typeof title === "string" ? t("titleTemplate").replace("%s", title) : title.absolute;
  const image = { ...SHARE_IMAGE, alt: t("shareImageAlt") };

  return {
    title,
    description,
    alternates: { canonical: url, languages: { fr: url, "x-default": url } },
    openGraph: {
      type: "website",
      locale: "fr_FR",
      siteName: "KolabReport",
      url,
      title: fullTitle,
      description,
      images: [image],
    },
    twitter: { card: "summary_large_image", title: fullTitle, description, images: [image] },
  };
}

/** For pages that only make sense to one person at one time: search engines leave them out. */
export const NOT_INDEXED: Metadata["robots"] = { index: false, follow: false };
