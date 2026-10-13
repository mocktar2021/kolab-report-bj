import { useFormatter, useTranslations } from "next-intl";
import { diffTemplates, foldUnchanged, type DiffLine } from "@/lib/prompts/diff";
import type { PromptVersionRow } from "@/lib/prompts/server";
import { cn } from "@/lib/utils";

type ChangedField =
  | "title"
  | "description"
  | "outputSchema"
  | "modelTier"
  | "temperature"
  | "maxOutputTokens";

type VersionDiffProps = {
  version: PromptVersionRow;
  /** The version just below, or null for version 1. */
  previous: PromptVersionRow | null;
};

/** Template changes line by line, and the other fields that changed, since the previous version. */
export function VersionDiff({ version, previous }: VersionDiffProps) {
  const t = useTranslations("Prompts");
  const format = useFormatter();

  if (!previous) {
    return (
      <DiffSection title={t("diffFirstTitle")}>
        <p className="px-5 py-6 text-sm text-muted-foreground">{t("diffFirst")}</p>
      </DiffSection>
    );
  }

  const lines = diffTemplates(previous.template, version.template);
  const changed = lines?.some((line) => line.kind !== "same") ?? true;

  const show = {
    title: (row: PromptVersionRow) => row.title,
    description: (row: PromptVersionRow) => row.description ?? t("none"),
    outputSchema: (row: PromptVersionRow) => t(`outputSchemas.${row.outputSchema}.label`),
    modelTier: (row: PromptVersionRow) => t(`modelTiers.${row.modelTier}.label`),
    temperature: (row: PromptVersionRow) =>
      row.temperature === null ? t("byDefault") : format.number(row.temperature),
    maxOutputTokens: (row: PromptVersionRow) =>
      row.maxOutputTokens === null ? t("byDefault") : t("tokens", { count: row.maxOutputTokens }),
  } satisfies Record<ChangedField, (row: PromptVersionRow) => string>;
  const fields = (Object.keys(show) as ChangedField[]).filter(
    (field) => (previous[field] ?? null) !== (version[field] ?? null),
  );

  return (
    <DiffSection title={t("diffTitle", { version: previous.version })}>
      {lines === null ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">
          {t("diffTooLarge", { version: previous.version })}
        </p>
      ) : !changed ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">{t("diffSame")}</p>
      ) : (
        <div
          role="group"
          aria-label={t("diffLabel", { version: previous.version })}
          className="max-h-[36rem] overflow-auto py-2 font-mono text-[13px] leading-relaxed"
        >
          {foldUnchanged(lines).map((block) =>
            block.kind === "skip" ? (
              <p
                key={`skip-${block.index}`}
                className="my-1 bg-muted/50 px-5 py-1 font-sans text-xs text-muted-foreground"
              >
                {t("diffSkipped", { count: block.count })}
              </p>
            ) : (
              <DiffRow key={block.index} line={block.line} />
            ),
          )}
        </div>
      )}

      <div className="border-t px-5 py-4">
        <h3 className="text-sm font-medium">{t("fieldsTitle")}</h3>
        {fields.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">{t("fieldsSame")}</p>
        ) : (
          <dl className="mt-3 space-y-3 text-sm">
            {fields.map((field) => (
              <div key={field}>
                <dt className="font-medium">{t(`fields.${field}`)}</dt>
                <dd className="mt-1 grid gap-1 sm:grid-cols-[4.5rem_minmax(0,1fr)]">
                  <span className="text-xs text-muted-foreground sm:pt-0.5">{t("before")}</span>
                  <del className="break-words text-muted-foreground">{show[field](previous)}</del>
                  <span className="text-xs text-muted-foreground sm:pt-0.5">{t("after")}</span>
                  <ins className="break-words no-underline">{show[field](version)}</ins>
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </DiffSection>
  );
}

function DiffSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      aria-labelledby="version-diff-title"
      className="surface-card overflow-hidden rounded-2xl border shadow-sm"
    >
      <div className="border-b px-5 py-4">
        <h2 id="version-diff-title" className="font-medium">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

/** One line. The sign and a hidden word say what changed, so color is never the only cue. */
function DiffRow({ line }: { line: DiffLine }) {
  const t = useTranslations("Prompts");
  const text = line.text === "" ? " " : line.text;

  if (line.kind === "same") {
    return (
      <div className="flex gap-3 px-5 text-muted-foreground">
        <span aria-hidden="true" className="w-3 shrink-0 select-none" />
        <span className="min-w-0 whitespace-pre-wrap break-words">{text}</span>
      </div>
    );
  }

  const added = line.kind === "added";
  const Tag = added ? "ins" : "del";
  return (
    <Tag
      className={cn(
        "flex gap-3 px-5 no-underline",
        added
          ? "bg-emerald-500/10 text-emerald-900 dark:text-emerald-200"
          : "bg-red-500/10 text-red-900 dark:text-red-200",
      )}
    >
      <span aria-hidden="true" className="w-3 shrink-0 select-none font-semibold">
        {added ? "+" : "-"}
      </span>
      <span className="sr-only">{added ? t("diffAdded") : t("diffRemoved")} </span>
      <span className="min-w-0 whitespace-pre-wrap break-words">{text}</span>
    </Tag>
  );
}
