import { GUIDE_PATH } from "@/content/guide/pages";
import { LEGAL_PAGES } from "@/content/legal/pages";
import { routing, type Locale } from "@/i18n/routing";

type Env = Record<string, string | undefined>;

/** The address the app is served at, without a trailing slash (KRB-258). */
export function siteUrl(env: Env = process.env): string {
  return (env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

/**
 * Only production may show up in search results. Staging, previews and local
 * builds tell every crawler to stay away, so they never compete with
 * kolabreport.com. APP_ENV wins when it is set, so a staging project built
 * with `vercel build --prod` still counts as staging.
 */
export function isIndexable(env: Env = process.env): boolean {
  if (env.APP_ENV) return env.APP_ENV === "production";
  return env.VERCEL_ENV === "production";
}

/** "/" and "/tarifs" become "/fr" and "/fr/tarifs". */
export function localizedPath(path: string, locale: Locale = routing.defaultLocale): string {
  return path === "/" ? `/${locale}` : `/${locale}${path}`;
}

/**
 * The pages a visitor without an account can read, without the locale prefix.
 * They make up the sitemap. Sign-in and password pages are left out on
 * purpose: nobody searches for them.
 */
export const INDEXED_PATHS = ["/", "/tarifs", GUIDE_PATH, "/inscription", ...Object.values(LEGAL_PAGES)];

/**
 * What crawlers must not read, without the locale prefix: the signed-in app,
 * the account pages and the links that only work from an e-mail. The proxy
 * sends crawlers on them to the sign-in page anyway; this saves them the trip.
 */
export const PRIVATE_PATHS = [
  "/tableau-de-bord",
  "/espaces",
  "/rapports",
  "/organisations",
  "/compte",
  "/notifications",
  "/auth",
  "/invitations",
  "/mot-de-passe-oublie",
  "/reinitialiser-mot-de-passe",
  "/hors-ligne",
];
