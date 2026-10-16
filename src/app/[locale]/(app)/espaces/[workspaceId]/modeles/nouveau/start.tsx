import { useTranslations } from "next-intl";
import { ArrowRight, Copy, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { PromptTemplateSummary } from "@/lib/prompts/server";
import { GlobalBadge, PromptStatusBadge } from "../prompt-badges";

type NewTemplateStartProps = {
  workspaceId: string;
  /** Global templates and those of the workspace, as the library lists them. */
  templates: PromptTemplateSummary[];
};

/**
 * The three starts of "Nouveau modèle" (KRB-198): describe the template,
 * copy a KolabReport template, or copy one of the workspace. Describing
 * comes first: it is the start that needs no prompt writing. A copy opens
 * the editor on ?depuis=, like "Personnaliser".
 */
export function NewTemplateStart({ workspaceId, templates }: NewTemplateStartProps) {
  const t = useTranslations("Prompts.start");
  const newHref = `/espaces/${workspaceId}/modeles/nouveau`;
  const globals = templates.filter((template) => template.scope === "global");
  // Published or draft: an archived template is not offered as a start.
  const own = templates.filter((template) => template.scope === "workspace" && template.state !== "archived");

  return (
    <div className="mt-8 space-y-6">
      <section
        aria-labelledby="start-describe-title"
        className="surface-card rounded-2xl border border-highlight/30 p-5 shadow-sm sm:p-6"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 id="start-describe-title" className="flex items-center gap-2 font-medium">
              <PenLine className="size-4 shrink-0 text-highlight" aria-hidden="true" />
              {t("describeTitle")}
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("describeHelp")}</p>
          </div>
          <Button asChild shape="pill" className="shrink-0 self-start sm:self-auto">
            <Link href={`${newHref}/description`}>
              {t("describeAction")}
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </section>

      <CopyList
        id="start-global"
        title={t("globalTitle")}
        help={t("globalHelp")}
        templates={globals}
        newHref={newHref}
      />
      <CopyList
        id="start-workspace"
        title={t("workspaceTitle")}
        help={t("workspaceHelp")}
        templates={own}
        newHref={newHref}
        empty={t("workspaceEmpty")}
      />
    </div>
  );
}

type CopyListProps = {
  id: string;
  title: string;
  help: string;
  templates: PromptTemplateSummary[];
  newHref: string;
  empty?: string;
};

function CopyList({ id, title, help, templates, newHref, empty }: CopyListProps) {
  const t = useTranslations("Prompts");

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="surface-card overflow-hidden rounded-2xl border shadow-sm"
    >
      <div className="border-b px-5 py-4">
        <h2 id={`${id}-title`} className="font-medium">
          {title}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">{help}</p>
      </div>
      {templates.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y">
          {templates.map((template) => (
            <li
              key={`${template.scope}/${template.templateKey}`}
              className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="break-words font-medium text-foreground">{template.current.title}</span>
                  {template.scope === "global" ? (
                    <GlobalBadge />
                  ) : (
                    <PromptStatusBadge status={template.state} />
                  )}
                </p>
                {template.current.description ? (
                  <p className="mt-1 break-words text-sm text-muted-foreground">
                    {template.current.description}
                  </p>
                ) : null}
                <p className="mt-1 text-xs text-muted-foreground">
                  {t(`outputSchemas.${template.current.outputSchema}.label`)}
                </p>
              </div>
              <Button
                asChild
                variant="outline"
                size="sm"
                shape="pill"
                className="shrink-0 self-start sm:self-auto"
              >
                <Link
                  href={`${newHref}?depuis=${template.current.id}`}
                  aria-label={t("start.copyLabel", { title: template.current.title })}
                >
                  <Copy aria-hidden="true" />
                  {t("start.copy")}
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
