import { useTranslations } from "next-intl";
import { FolderPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

/** First visit: the user belongs to no workspace yet. */
export function NoWorkspace() {
  const t = useTranslations("Dashboard.noWorkspace");

  return (
    <section
      aria-labelledby="no-workspace-title"
      className="surface-card mt-8 rounded-2xl border px-6 py-12 text-center shadow-sm"
    >
      <span className="mx-auto flex size-11 items-center justify-center rounded-xl bg-highlight/10 text-highlight ring-1 ring-inset ring-highlight/20">
        <FolderPlus className="size-5" aria-hidden="true" />
      </span>
      <h2 id="no-workspace-title" className="mt-4 text-h3">
        {t("title")}
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{t("description")}</p>
      <Button asChild shape="pill" className="mt-6">
        <Link href="/espaces/nouveau">{t("cta")}</Link>
      </Button>
      <p className="mx-auto mt-4 max-w-md text-xs text-muted-foreground">{t("invited")}</p>
    </section>
  );
}
