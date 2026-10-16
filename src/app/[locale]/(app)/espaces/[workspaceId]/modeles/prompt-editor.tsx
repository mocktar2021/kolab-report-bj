"use client";

import { useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, ChevronRight, Eye, RefreshCw } from "lucide-react";
import { FieldError } from "@/components/auth/field-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Link, useRouter } from "@/i18n/navigation";
import {
  approximatePages,
  approximateWords,
  MODEL_TIERS,
  OUTPUT_SCHEMAS,
  PROMPT_LIMITS,
  PROMPT_VARIABLES,
  type ModelTier,
  type OutputSchema,
  type PromptVariable,
} from "@/lib/prompts/catalog";
import { promptFieldErrors, promptVersionSchema, type PromptFieldErrorKey } from "@/lib/prompts/schema";
import { checkTemplate, renderTemplate } from "@/lib/prompts/template";
import { cn } from "@/lib/utils";
import { savePromptVersion, type PromptActionError } from "./actions";
import type { EditorValues } from "./editor-values";

type Field = keyof EditorValues;
type FieldErrors = Partial<Record<string, PromptFieldErrorKey>>;

const FIELD_IDS: Record<Field, string> = {
  title: "prompt-title",
  description: "prompt-description",
  template: "prompt-template",
  outputSchema: "prompt-output-schema",
  modelTier: "prompt-model-tier",
  temperature: "prompt-temperature",
  maxOutputTokens: "prompt-max-output-tokens",
  changelog: "prompt-changelog",
};

/** Technical settings, folded under "Réglages avancés" (KRB-198). */
const ADVANCED_FIELDS: readonly Field[] = ["modelTier", "temperature", "maxOutputTokens"];

/** The words and pages a cap in tokens gives, when the field holds a valid one. */
function capInWords(value: string): { words: number; pages: number } | null {
  const tokens = Number(value.trim());
  if (
    value.trim() === "" ||
    !Number.isInteger(tokens) ||
    tokens < PROMPT_LIMITS.maxOutputTokensMin ||
    tokens > PROMPT_LIMITS.maxOutputTokensMax
  )
    return null;
  const words = approximateWords(tokens);
  return { words, pages: approximatePages(words) };
}

// Same look as <Input>, for the multi-line fields.
const textareaClass =
  "flex w-full rounded-lg border border-input bg-card px-3 py-2 text-base shadow-sm transition-[border-color,box-shadow] duration-200 placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm";

const cardClass = "surface-card rounded-2xl border p-5 shadow-sm sm:p-6";

type PromptEditorProps = {
  workspaceId: string;
  /** Null for a new template, otherwise the version the new one starts from. */
  baseId: string | null;
  /** Latest version number when the page was loaded, null for a new template. */
  expectedLatest: number | null;
  initial: EditorValues;
  cancelHref: string;
};

/** Form for a new template or a new version of one, with live checks and a preview. */
export function PromptEditor({
  workspaceId,
  baseId,
  expectedLatest,
  initial,
  cancelHref,
}: PromptEditorProps) {
  const t = useTranslations("Prompts");
  const router = useRouter();
  const [values, setValues] = useState<EditorValues>(initial);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<PromptActionError | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const templateRef = useRef<HTMLTextAreaElement>(null);
  const advancedRef = useRef<HTMLDetailsElement>(null);
  const caretAfterInsert = useRef<number | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const isNew = baseId === null;

  const check = useMemo(() => checkTemplate(values.template), [values.template]);
  const templateEmpty = values.template.trim() === "";
  const templateBroken = check.unclosed || check.unknown.length > 0;
  const blocked = templateEmpty || templateBroken;

  const samples = useMemo(
    () =>
      Object.fromEntries(PROMPT_VARIABLES.map((name) => [name, t(`variables.${name}.sample`)])) as Record<
        PromptVariable,
        string
      >,
    [t],
  );
  const preview = useMemo(() => renderTemplate(values.template, samples), [values.template, samples]);

  // Puts the caret after a variable inserted with the buttons, once React has written the text.
  useLayoutEffect(() => {
    const position = caretAfterInsert.current;
    if (position === null) return;
    caretAfterInsert.current = null;
    templateRef.current?.focus();
    templateRef.current?.setSelectionRange(position, position);
  }, [values.template]);

  function update<K extends Field>(field: K, value: EditorValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
    if (fieldErrors[field]) {
      setFieldErrors((current) => {
        const next = { ...current };
        delete next[field];
        return next;
      });
    }
  }

  function insertVariable(name: PromptVariable) {
    const token = `{{${name}}}`;
    const textarea = templateRef.current;
    const start = textarea?.selectionStart ?? values.template.length;
    const end = textarea?.selectionEnd ?? values.template.length;
    caretAfterInsert.current = start + token.length;
    update("template", values.template.slice(0, start) + token + values.template.slice(end));
  }

  function focusFirstError(errors: FieldErrors) {
    const first = (Object.keys(FIELD_IDS) as Field[]).find((field) => errors[field]);
    if (!first) return;
    // A field inside the folded settings can't take the focus until they open.
    if (ADVANCED_FIELDS.includes(first) && advancedRef.current) {
      advancedRef.current.open = true;
      setAdvancedOpen(true);
    }
    document.getElementById(FIELD_IDS[first])?.focus();
  }

  function save(publish: boolean) {
    setError(null);
    const input = { ...values, publish };
    // Same schema as the server, so most mistakes show without a round trip.
    const parsed = promptVersionSchema(isNew).safeParse(input);
    if (!parsed.success) {
      const errors = promptFieldErrors(parsed.error);
      setFieldErrors(errors);
      focusFirstError(errors);
      return;
    }
    setFieldErrors({});
    startTransition(async () => {
      try {
        const result = await savePromptVersion({ workspaceId, baseId, expectedLatest, values: input });
        if (result.ok) {
          // Keeps both buttons off while the next page loads, so a second click saves nothing.
          setSaved(true);
          router.push(`/espaces/${workspaceId}/modeles/${result.id}`);
          return;
        }
        setError(result.error);
        const errors = result.fieldErrors ?? {};
        setFieldErrors(errors);
        focusFirstError(errors);
      } catch {
        setError("generic");
      }
    });
  }

  function reload() {
    setError(null);
    // The form keeps its values; the page sends the new latest version number.
    startTransition(() => router.refresh());
  }

  const errorText = (field: Field) => {
    const key = fieldErrors[field];
    return key ? t(`fieldErrors.${key}`) : undefined;
  };
  const describedBy = (...ids: (string | false)[]) => ids.filter(Boolean).join(" ") || undefined;
  const disabled = pending || saved;
  const advancedChanged =
    values.modelTier !== "standard" ||
    values.temperature.trim() !== "" ||
    values.maxOutputTokens.trim() !== "";
  const cap = capInWords(values.maxOutputTokens);

  return (
    <form
      noValidate
      className="mt-8 space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        const submitter = (event.nativeEvent as SubmitEvent).submitter;
        save(submitter?.getAttribute("value") === "publish");
      }}
    >
      <div className={cn(cardClass, "space-y-5")}>
        <div className="space-y-2">
          <Label htmlFor={FIELD_IDS.title}>{t("fields.title")}</Label>
          <Input
            id={FIELD_IDS.title}
            value={values.title}
            onChange={(event) => update("title", event.target.value)}
            maxLength={PROMPT_LIMITS.titleMax}
            autoComplete="off"
            aria-invalid={Boolean(fieldErrors.title)}
            aria-describedby={describedBy(Boolean(fieldErrors.title) && "prompt-title-error")}
          />
          <FieldError id="prompt-title-error" message={errorText("title")} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={FIELD_IDS.description}>
            {t("fields.description")}{" "}
            <span className="font-normal text-muted-foreground">{t("editor.optional")}</span>
          </Label>
          <textarea
            id={FIELD_IDS.description}
            value={values.description}
            onChange={(event) => update("description", event.target.value)}
            rows={2}
            maxLength={PROMPT_LIMITS.descriptionMax}
            className={textareaClass}
            aria-invalid={Boolean(fieldErrors.description)}
            aria-describedby={describedBy(
              "prompt-description-help",
              Boolean(fieldErrors.description) && "prompt-description-error",
            )}
          />
          <p id="prompt-description-help" className="text-xs text-muted-foreground">
            {t("editor.descriptionHelp")}
          </p>
          <FieldError id="prompt-description-error" message={errorText("description")} />
        </div>
        {/* The type of result shapes the draft experts get, so it stays in view. */}
        <div className="space-y-2">
          <Label htmlFor={FIELD_IDS.outputSchema}>{t("fields.outputSchema")}</Label>
          <NativeSelect
            id={FIELD_IDS.outputSchema}
            value={values.outputSchema}
            onChange={(event) => update("outputSchema", event.target.value as OutputSchema)}
            selectClassName="h-10"
            aria-invalid={Boolean(fieldErrors.outputSchema)}
            aria-describedby={describedBy(
              "prompt-output-schema-help",
              Boolean(fieldErrors.outputSchema) && "prompt-output-schema-error",
            )}
          >
            {OUTPUT_SCHEMAS.map((schema) => (
              <option key={schema} value={schema}>
                {t(`outputSchemas.${schema}.label`)}
              </option>
            ))}
          </NativeSelect>
          <p id="prompt-output-schema-help" className="text-xs text-muted-foreground">
            {t(`outputSchemas.${values.outputSchema}.description`)}
          </p>
          <FieldError id="prompt-output-schema-error" message={errorText("outputSchema")} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className={cn(cardClass, "min-w-0 space-y-3")}>
          <div className="space-y-1">
            <Label htmlFor={FIELD_IDS.template}>{t("fields.template")}</Label>
            <p id="prompt-template-help" className="text-xs text-muted-foreground">
              {t("editor.templateHelp")}
            </p>
          </div>
          <div
            role="group"
            aria-labelledby="prompt-variables-label"
            className="flex flex-wrap items-center gap-1.5"
          >
            <span id="prompt-variables-label" className="mr-1 text-xs font-medium text-muted-foreground">
              {t("editor.variablesLabel")}
            </span>
            {PROMPT_VARIABLES.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => insertVariable(name)}
                title={t(`variables.${name}.description`)}
                aria-label={t("editor.insertVariable", {
                  token: `{{${name}}}`,
                  label: t(`variables.${name}.label`),
                })}
                className={cn(
                  "rounded-md border px-2 py-1 font-mono text-xs outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                  check.variables.includes(name)
                    ? "border-highlight/30 bg-highlight/[0.08] text-foreground"
                    : "bg-card text-muted-foreground",
                )}
              >
                {`{{${name}}}`}
              </button>
            ))}
          </div>
          <textarea
            id={FIELD_IDS.template}
            ref={templateRef}
            value={values.template}
            onChange={(event) => update("template", event.target.value)}
            rows={18}
            spellCheck={false}
            className={cn(
              textareaClass,
              "min-h-[22rem] font-mono text-[13px] leading-relaxed md:text-[13px]",
            )}
            aria-invalid={templateBroken || Boolean(fieldErrors.template)}
            aria-describedby={describedBy(
              "prompt-template-help",
              "prompt-template-check",
              Boolean(fieldErrors.template) && "prompt-template-error",
            )}
          />
          <div id="prompt-template-check" className="space-y-1.5 text-sm">
            <div aria-live="polite" className="space-y-1.5">
              {check.unclosed ? (
                <p className="flex items-start gap-1.5 text-destructive">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {t("editor.unclosed")}
                </p>
              ) : null}
              {check.unknown.length > 0 ? (
                <p className="flex items-start gap-1.5 break-words text-destructive">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0">
                    {t("editor.unknown", {
                      count: check.unknown.length,
                      names: check.unknown.map((name) => `{{${name}}}`).join(", "),
                    })}
                  </span>
                </p>
              ) : null}
            </div>
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span>{t("editor.detected")}</span>
              {check.variables.length === 0 ? (
                <span>{t("editor.noneDetected")}</span>
              ) : (
                check.variables.map((name) => (
                  <span key={name} className="rounded bg-muted px-1.5 py-0.5 text-foreground">
                    {t(`variables.${name}.label`)}
                  </span>
                ))
              )}
            </p>
          </div>
          <FieldError id="prompt-template-error" message={errorText("template")} />
        </div>

        <section
          aria-labelledby="prompt-preview-title"
          className="flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-muted/20 lg:max-h-[46rem]"
        >
          <div className="border-b px-5 py-3">
            <h2 id="prompt-preview-title" className="flex items-center gap-1.5 text-sm font-medium">
              <Eye className="size-4 text-muted-foreground" aria-hidden="true" />
              {t("editor.preview")}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("editor.previewHelp")}</p>
          </div>
          {preview.trim() === "" ? (
            <p className="px-5 py-4 text-sm text-muted-foreground">{t("editor.previewEmpty")}</p>
          ) : (
            // Plain text on purpose: the AI receives the prompt as written, not rendered Markdown.
            <pre className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words px-5 py-4 font-sans text-sm leading-relaxed">
              {preview}
            </pre>
          )}
        </section>
      </div>

      <details
        ref={advancedRef}
        open={advancedOpen}
        onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
        className={cn(cardClass, "group")}
      >
        <summary className="-m-2 flex cursor-pointer list-none items-start gap-2 rounded-lg p-2 outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          <ChevronRight
            className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
            aria-hidden="true"
          />
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2 font-medium">
              {t("editor.advanced")}
              {advancedChanged ? (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {t("editor.advancedChanged")}
                </span>
              ) : null}
            </span>
            <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
              {t("editor.advancedHelp")}
            </span>
          </span>
        </summary>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={FIELD_IDS.modelTier}>{t("fields.modelTier")}</Label>
            <NativeSelect
              id={FIELD_IDS.modelTier}
              value={values.modelTier}
              onChange={(event) => update("modelTier", event.target.value as ModelTier)}
              selectClassName="h-10"
              aria-invalid={Boolean(fieldErrors.modelTier)}
              aria-describedby={describedBy(
                "prompt-model-tier-help",
                Boolean(fieldErrors.modelTier) && "prompt-model-tier-error",
              )}
            >
              {MODEL_TIERS.map((tier) => (
                <option key={tier} value={tier}>
                  {t(`modelTiers.${tier}.label`)}
                </option>
              ))}
            </NativeSelect>
            <p id="prompt-model-tier-help" className="text-xs text-muted-foreground">
              {t(`modelTiers.${values.modelTier}.description`)}
            </p>
            <FieldError id="prompt-model-tier-error" message={errorText("modelTier")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={FIELD_IDS.temperature}>{t("fields.temperature")}</Label>
            <Input
              id={FIELD_IDS.temperature}
              value={values.temperature}
              onChange={(event) => update("temperature", event.target.value)}
              inputMode="decimal"
              autoComplete="off"
              placeholder={t("editor.placeholderDefault")}
              aria-invalid={Boolean(fieldErrors.temperature)}
              aria-describedby={describedBy(
                "prompt-temperature-help",
                Boolean(fieldErrors.temperature) && "prompt-temperature-error",
              )}
            />
            <p id="prompt-temperature-help" className="text-xs text-muted-foreground">
              {t("editor.temperatureHelp")}
            </p>
            <FieldError id="prompt-temperature-error" message={errorText("temperature")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={FIELD_IDS.maxOutputTokens}>{t("fields.maxOutputTokens")}</Label>
            <Input
              id={FIELD_IDS.maxOutputTokens}
              value={values.maxOutputTokens}
              onChange={(event) => update("maxOutputTokens", event.target.value)}
              inputMode="numeric"
              autoComplete="off"
              placeholder={t("editor.placeholderDefault")}
              aria-invalid={Boolean(fieldErrors.maxOutputTokens)}
              aria-describedby={describedBy(
                "prompt-max-output-tokens-help",
                Boolean(fieldErrors.maxOutputTokens) && "prompt-max-output-tokens-error",
              )}
            />
            <p id="prompt-max-output-tokens-help" className="text-xs text-muted-foreground">
              {t("editor.maxOutputTokensHelp")}
              {cap ? <> {t("editor.maxOutputTokensWords", cap)}</> : null}
            </p>
            <FieldError id="prompt-max-output-tokens-error" message={errorText("maxOutputTokens")} />
          </div>
        </div>
      </details>

      <div className={cn(cardClass, "space-y-2")}>
        <Label htmlFor={FIELD_IDS.changelog}>
          {t("fields.changelog")}
          {isNew ? (
            <>
              {" "}
              <span className="font-normal text-muted-foreground">{t("editor.optional")}</span>
            </>
          ) : null}
        </Label>
        <textarea
          id={FIELD_IDS.changelog}
          value={values.changelog}
          onChange={(event) => update("changelog", event.target.value)}
          rows={2}
          maxLength={PROMPT_LIMITS.changelogMax}
          required={!isNew}
          className={textareaClass}
          aria-invalid={Boolean(fieldErrors.changelog)}
          aria-describedby={describedBy(
            "prompt-changelog-help",
            Boolean(fieldErrors.changelog) && "prompt-changelog-error",
          )}
        />
        <p id="prompt-changelog-help" className="text-xs text-muted-foreground">
          {isNew ? t("editor.changelogHelpFirst") : t("editor.changelogHelp")}
        </p>
        <FieldError id="prompt-changelog-error" message={errorText("changelog")} />
      </div>

      {error === "conflict" ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm"
        >
          <p>{isNew ? t("editor.conflictNew") : t("editor.conflictVersion")}</p>
          {isNew ? null : (
            <Button type="button" size="sm" variant="outline" className="mt-3" onClick={reload}>
              <RefreshCw aria-hidden="true" />
              {t("editor.reload")}
            </Button>
          )}
        </div>
      ) : error ? (
        <p role="alert" className="text-sm text-destructive">
          {t(`actionErrors.${error}`)}
        </p>
      ) : null}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
        <p id="prompt-save-hint" aria-live="polite" className="text-sm text-muted-foreground sm:mr-auto">
          {pending
            ? t("editor.saving")
            : templateBroken
              ? t("editor.invalidHint")
              : templateEmpty
                ? t("fieldErrors.templateEmpty")
                : null}
        </p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button asChild variant="ghost" shape="pill">
            <Link href={cancelHref}>{t("editor.cancel")}</Link>
          </Button>
          {/* First in the form, so Enter in a field saves a draft rather than publishing. */}
          <Button
            type="submit"
            name="intent"
            value="draft"
            variant="outline"
            shape="pill"
            disabled={blocked || disabled}
            aria-describedby={blocked ? "prompt-save-hint" : undefined}
          >
            {t("editor.saveDraft")}
          </Button>
          <Button
            type="submit"
            name="intent"
            value="publish"
            shape="pill"
            disabled={blocked || disabled}
            aria-describedby={blocked ? "prompt-save-hint" : undefined}
          >
            {t("editor.publish")}
          </Button>
        </div>
      </div>
    </form>
  );
}
