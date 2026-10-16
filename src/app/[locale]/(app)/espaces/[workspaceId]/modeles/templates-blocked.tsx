import { useTranslations } from "next-intl";
import { ReadOnlyNotice } from "@/components/billing/read-only-notice";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { TemplatePlan } from "@/lib/prompts/plan";
import { TemplatesPlanNotice } from "./templates-plan-notice";

/**
 * Takes the place of the editor when no template can be saved: the
 * workspace is read-only, or its plan has no custom templates (KRB-198).
 */
export function TemplatesBlocked({ plan, workspaceId }: { plan: TemplatePlan; workspaceId: string }) {
  const t = useTranslations("Prompts");
  return (
    <div className="mt-6 max-w-3xl space-y-4">
      {plan.readOnly ? <ReadOnlyNotice reason={plan.readOnly} /> : <TemplatesPlanNotice plan={plan} />}
      <Button asChild variant="outline" shape="pill">
        <Link href={`/espaces/${workspaceId}/modeles`}>{t("backToLibraryButton")}</Link>
      </Button>
    </div>
  );
}
