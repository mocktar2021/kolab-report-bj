import { useTranslations } from "next-intl";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

/** Shown to experts and viewers on the editor pages, like the members page does. */
export function PromptsForbidden({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations("Prompts");

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:py-12">
      <div className="surface-card rounded-2xl border p-6 text-center shadow-sm">
        <ShieldAlert className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
        <h1 className="mt-3 text-h3">{t("forbiddenTitle")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("forbiddenDescription")}</p>
        <Button asChild variant="outline" shape="pill" className="mt-5">
          <Link href={`/espaces/${workspaceId}/modeles`}>{t("backToLibraryButton")}</Link>
        </Button>
      </div>
    </div>
  );
}
