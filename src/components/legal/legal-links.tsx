import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { LEGAL_PAGES, MAIN_LEGAL_PAGE_KEYS, type LegalPageKey } from "@/content/legal/pages";
import { cn } from "@/lib/utils";

/**
 * A row of links to the legal pages, for the sign-in pages and the app.
 * Shared component: the sidebar renders it in the browser, so the appShell
 * scope sends Legal.nav (src/i18n/client-messages.ts).
 */
export function LegalLinks({
  pages = MAIN_LEGAL_PAGE_KEYS,
  className,
  listClassName,
}: {
  pages?: readonly LegalPageKey[];
  className?: string;
  listClassName?: string;
}) {
  const t = useTranslations("Legal.nav");

  return (
    <nav aria-label={t("label")} className={className}>
      <ul className={cn("flex flex-wrap gap-x-3 gap-y-1", listClassName)}>
        {pages.map((key) => (
          <li key={key}>
            {/* No prefetch: these links are on every page and rarely followed. */}
            <Link
              href={LEGAL_PAGES[key]}
              prefetch={false}
              className="inline-block rounded py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t(key)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
