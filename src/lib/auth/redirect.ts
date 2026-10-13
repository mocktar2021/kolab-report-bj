import { routing } from "@/i18n/routing";

const LOCALE_PREFIX = new RegExp(`^/(${routing.locales.join("|")})(?=/|$)`);

/**
 * Returns `value` when it is a same-site path ("/fr/..."), otherwise null.
 * Rejects absolute URLs, protocol-relative "//host", backslash tricks
 * ("/\host" is read as "//host" by browsers) and control characters.
 */
export function safeNextPath(value: string | null | undefined): string | null {
  if (!value || value.length > 512) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (/[\\\u0000-\u001f]/.test(value)) return null;
  return value;
}

/** "/fr/tableau-de-bord?x=1" -> "/tableau-de-bord?x=1", for next-intl redirects. */
export function withoutLocale(path: string): string {
  return path.replace(LOCALE_PREFIX, "") || "/";
}
