"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, ArrowLeft, Info, Sparkles } from "lucide-react";
import { FieldError } from "@/components/auth/field-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  BUILDER_LENGTHS,
  BUILDER_LIMITS,
  BUILDER_MISSING,
  BUILDER_TONES,
  builderAnswersSchema,
  builderFieldErrors,
  buildTemplate,
  DEFAULT_BUILDER_ANSWERS,
  type BuilderAnswers,
  type BuilderErrorKey,
} from "@/lib/prompts/builder";
import { OUTPUT_SCHEMAS, PROMPT_LIMITS, type OutputSchema } from "@/lib/prompts/catalog";
import { WRITER_LIMITS, type WriterNote } from "@/lib/prompts/writer";
import { cn } from "@/lib/utils";
import { writeTemplateWithAi, type WriteTemplateError } from "../../assist-actions";
import { EMPTY_EDITOR_VALUES, type EditorValues } from "../../editor-values";
import { PromptEditor } from "../../prompt-editor";

type Mode = "form" | "ai";

type Review = {
  initial: EditorValues;
  source: "form" | "ai" | "blank";
  notes: WriterNote[];
  removed: string[];
  /** A new editor for each review, so it starts from these values. */
  key: number;
};

type AssistFailure = { error: WriteTemplateError; retryAfter?: number };

const FIELD_IDS: Record<keyof BuilderAnswers, string> = {
  title: "builder-title",
  outputSchema: "builder-output-schema",
  content: "builder-content",
  headings: "builder-headings",
  tone: "builder-tone-professionnel",
  length: "builder-length-moyenne",
  missing: "builder-missing-signaler",
};

const textareaClass =
  "flex w-full rounded-lg border border-input bg-card px-3 py-2 text-base shadow-sm transition-[border-color,box-shadow] duration-200 placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm";

const cardClass = "surface-card rounded-2xl border p-5 shadow-sm sm:p-6";

type DescribeTemplateProps = {
  workspaceId: string;
  /** False when the server has no AI for drafts: "Rédiger avec l'IA" is off, with the reason. */
  aiAvailable: boolean;
  /** "Rédiger avec l'IA" calls per person and day (AI_TEMPLATE_WRITER_PER_DAY). */
  dailyLimit: number;
  cancelHref: string;
};

/**
 * "Décrire le modèle" (KRB-198). Either a short form, turned into a
 * template by buildTemplate without the AI, or a few sentences that
 * "Rédiger avec l'IA" turns into one. Both open the editor on the result,
 * to read and change before saving. Nothing is saved before that.
 */
export function DescribeTemplate({
  workspaceId,
  aiAvailable,
  dailyLimit,
  cancelHref,
}: DescribeTemplateProps) {
  const t = useTranslations("Prompts");
  const [mode, setMode] = useState<Mode>("form");
  const [answers, setAnswers] = useState<BuilderAnswers>(DEFAULT_BUILDER_ANSWERS);
  const [errors, setErrors] = useState<Partial<Record<keyof BuilderAnswers, BuilderErrorKey>>>({});
  const [description, setDescription] = useState("");
  const [aiSchema, setAiSchema] = useState<OutputSchema>("section_draft");
  const [aiFailure, setAiFailure] = useState<AssistFailure | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [pending, startTransition] = useTransition();
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const modeLegend = useRef<HTMLLegendElement>(null);
  const moved = useRef(false);

  // Moves the focus with the step, so keyboard and screen reader users follow.
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    (review ? reviewHeading.current : modeLegend.current?.parentElement)?.focus();
  }, [review]);

  function openReview(next: Omit<Review, "key">) {
    moved.current = true;
    setReview((current) => ({ ...next, key: (current?.key ?? 0) + 1 }));
  }

  function back() {
    moved.current = true;
    setReview(null);
  }

  function update<K extends keyof BuilderAnswers>(field: K, value: BuilderAnswers[K]) {
    setAnswers((current) => ({ ...current, [field]: value }));
    if (errors[field])
      setErrors((current) => {
        const next = { ...current };
        delete next[field];
        return next;
      });
  }

  function submitForm() {
    const parsed = builderAnswersSchema.safeParse(answers);
    if (!parsed.success) {
      const found = builderFieldErrors(parsed.error);
      setErrors(found);
      const first = (Object.keys(FIELD_IDS) as (keyof BuilderAnswers)[]).find((field) => found[field]);
      if (first) document.getElementById(FIELD_IDS[first])?.focus();
      return;
    }
    setErrors({});
    const built = buildTemplate(parsed.data);
    openReview({
      initial: {
        ...EMPTY_EDITOR_VALUES,
        title: built.title,
        description: built.description,
        template: built.template,
        outputSchema: built.outputSchema,
        changelog: t("builder.review.changelogForm"),
      },
      source: "form",
      notes: [],
      removed: [],
    });
  }

  function submitAi() {
    const length = [...description.trim()].length;
    if (length < WRITER_LIMITS.descriptionMin || length > WRITER_LIMITS.descriptionMax) {
      setAiFailure({
        error: length < WRITER_LIMITS.descriptionMin ? "descriptionTooShort" : "descriptionTooLong",
      });
      document.getElementById("assist-description")?.focus();
      return;
    }
    setAiFailure(null);
    startTransition(async () => {
      try {
        const result = await writeTemplateWithAi({ workspaceId, description, outputSchema: aiSchema });
        if (!result.ok) {
          setAiFailure({ error: result.error, retryAfter: result.retryAfter });
          return;
        }
        openReview({
          initial: {
            ...EMPTY_EDITOR_VALUES,
            title: result.title,
            description: result.description,
            template: result.template,
            outputSchema: aiSchema,
            changelog: t("builder.review.changelogAi"),
          },
          source: "ai",
          notes: result.notes,
          removed: result.removed,
        });
      } catch {
        setAiFailure({ error: "generic" });
      }
    });
  }

  function startBlank() {
    openReview({ initial: EMPTY_EDITOR_VALUES, source: "blank", notes: [], removed: [] });
  }

  if (review) {
    return (
      <section aria-labelledby="review-title" className="mt-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 max-w-3xl">
            <h2 id="review-title" ref={reviewHeading} tabIndex={-1} className="text-h3 outline-none">
              {t("builder.review.title")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {review.source === "ai"
                ? t("builder.review.fromAi")
                : review.source === "form"
                  ? t("builder.review.fromForm")
                  : t("builder.review.blank")}
            </p>
            {review.notes.length > 0 ? (
              <ul className="mt-3 space-y-1.5 rounded-xl border bg-muted/40 px-4 py-3 text-sm">
                {review.notes.map((note) => (
                  <li key={note} className="flex items-start gap-2">
                    <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span>
                      {t(`assist.notes.${note}`, {
                        names: review.removed.join(", "),
                        token: "{{deliverables}}",
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <Button type="button" variant="outline" shape="pill" className="shrink-0 self-start" onClick={back}>
            <ArrowLeft aria-hidden="true" />
            {t("builder.review.back")}
          </Button>
        </div>
        <PromptEditor
          key={review.key}
          workspaceId={workspaceId}
          baseId={null}
          expectedLatest={null}
          initial={review.initial}
          cancelHref={cancelHref}
        />
      </section>
    );
  }

  const errorText = (field: keyof BuilderAnswers) =>
    errors[field] ? t(`builder.errors.${errors[field]}`) : undefined;
  const describedBy = (...ids: (string | false)[]) => ids.filter(Boolean).join(" ") || undefined;
  const descriptionLength = [...description].length;

  return (
    <div className="mt-8 space-y-6">
      <fieldset tabIndex={-1} className="outline-none">
        <legend ref={modeLegend} className="text-sm font-medium">
          {t("builder.modeLegend")}
        </legend>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <ModeOption
            value="form"
            checked={mode === "form"}
            onSelect={setMode}
            label={t("builder.modeForm")}
            help={t("builder.modeFormHelp")}
          />
          <ModeOption
            value="ai"
            checked={mode === "ai"}
            onSelect={setMode}
            disabled={!aiAvailable}
            label={t("builder.modeAi")}
            help={aiAvailable ? t("builder.modeAiHelp") : t("assist.unavailable")}
            icon={<Sparkles className="size-4 text-highlight" aria-hidden="true" />}
          />
        </div>
      </fieldset>

      {mode === "form" ? (
        <form
          noValidate
          aria-label={t("builder.modeForm")}
          className={cn(cardClass, "space-y-5")}
          onSubmit={(event) => {
            event.preventDefault();
            submitForm();
          }}
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={FIELD_IDS.title}>{t("builder.fields.title")}</Label>
              <Input
                id={FIELD_IDS.title}
                value={answers.title}
                onChange={(event) => update("title", event.target.value)}
                maxLength={PROMPT_LIMITS.titleMax}
                autoComplete="off"
                aria-invalid={Boolean(errors.title)}
                aria-describedby={describedBy(
                  "builder-title-help",
                  Boolean(errors.title) && "builder-title-error",
                )}
              />
              <p id="builder-title-help" className="text-xs text-muted-foreground">
                {t("builder.help.title")}
              </p>
              <FieldError id="builder-title-error" message={errorText("title")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor={FIELD_IDS.outputSchema}>{t("builder.fields.outputSchema")}</Label>
              <NativeSelect
                id={FIELD_IDS.outputSchema}
                value={answers.outputSchema}
                onChange={(event) => update("outputSchema", event.target.value as OutputSchema)}
                selectClassName="h-10"
                aria-describedby="builder-output-schema-help"
              >
                {OUTPUT_SCHEMAS.map((schema) => (
                  <option key={schema} value={schema}>
                    {t(`outputSchemas.${schema}.label`)}
                  </option>
                ))}
              </NativeSelect>
              <p id="builder-output-schema-help" className="text-xs text-muted-foreground">
                {t(`outputSchemas.${answers.outputSchema}.description`)}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor={FIELD_IDS.content}>{t("builder.fields.content")}</Label>
            <textarea
              id={FIELD_IDS.content}
              value={answers.content}
              onChange={(event) => update("content", event.target.value)}
              rows={4}
              maxLength={BUILDER_LIMITS.contentMax}
              className={textareaClass}
              aria-invalid={Boolean(errors.content)}
              aria-describedby={describedBy(
                "builder-content-help",
                Boolean(errors.content) && "builder-content-error",
              )}
            />
            <p id="builder-content-help" className="text-xs text-muted-foreground">
              {t("builder.help.content")}
            </p>
            <FieldError id="builder-content-error" message={errorText("content")} />
          </div>

          <div className="space-y-2">
            <Label htmlFor={FIELD_IDS.headings}>
              {t("builder.fields.headings")}{" "}
              <span className="font-normal text-muted-foreground">{t("editor.optional")}</span>
            </Label>
            <textarea
              id={FIELD_IDS.headings}
              value={answers.headings}
              onChange={(event) => update("headings", event.target.value)}
              rows={3}
              className={textareaClass}
              aria-invalid={Boolean(errors.headings)}
              aria-describedby={describedBy(
                "builder-headings-help",
                Boolean(errors.headings) && "builder-headings-error",
              )}
            />
            <p id="builder-headings-help" className="text-xs text-muted-foreground">
              {t("builder.help.headings")}
            </p>
            <FieldError id="builder-headings-error" message={errorText("headings")} />
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <Choices
              name="tone"
              legend={t("builder.fields.tone")}
              options={BUILDER_TONES.map((value) => ({ value, label: t(`builder.tones.${value}`) }))}
              value={answers.tone}
              onChange={(value) => update("tone", value)}
              error={errorText("tone")}
            />
            <Choices
              name="length"
              legend={t("builder.fields.length")}
              options={BUILDER_LENGTHS.map((value) => ({ value, label: t(`builder.lengths.${value}`) }))}
              value={answers.length}
              onChange={(value) => update("length", value)}
              error={errorText("length")}
            />
            <Choices
              name="missing"
              legend={t("builder.fields.missing")}
              options={BUILDER_MISSING.map((value) => ({
                value,
                label: t(`builder.missingOptions.${value}`),
              }))}
              value={answers.missing}
              onChange={(value) => update("missing", value)}
              error={errorText("missing")}
            />
          </div>

          <div className="flex justify-end">
            <Button type="submit" shape="pill">
              {t("builder.submit")}
            </Button>
          </div>
        </form>
      ) : (
        <form
          noValidate
          aria-label={t("builder.modeAi")}
          aria-busy={pending}
          className={cn(cardClass, "space-y-5")}
          onSubmit={(event) => {
            event.preventDefault();
            submitAi();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="assist-description">{t("assist.description")}</Label>
            <textarea
              id="assist-description"
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
                if (aiFailure?.error === "descriptionTooShort" || aiFailure?.error === "descriptionTooLong")
                  setAiFailure(null);
              }}
              rows={6}
              maxLength={WRITER_LIMITS.descriptionMax}
              disabled={pending}
              className={textareaClass}
              aria-invalid={
                aiFailure?.error === "descriptionTooShort" || aiFailure?.error === "descriptionTooLong"
              }
              aria-describedby="assist-description-help assist-description-count"
            />
            <p id="assist-description-help" className="text-xs text-muted-foreground">
              {t("assist.descriptionHelp")}
            </p>
            <p id="assist-description-count" className="text-xs text-muted-foreground">
              {t("assist.count", { count: descriptionLength, max: WRITER_LIMITS.descriptionMax })}
            </p>
          </div>
          <div className="space-y-2 sm:max-w-sm">
            <Label htmlFor="assist-output-schema">{t("builder.fields.outputSchema")}</Label>
            <NativeSelect
              id="assist-output-schema"
              value={aiSchema}
              onChange={(event) => setAiSchema(event.target.value as OutputSchema)}
              disabled={pending}
              selectClassName="h-10"
              aria-describedby="assist-output-schema-help"
            >
              {OUTPUT_SCHEMAS.map((schema) => (
                <option key={schema} value={schema}>
                  {t(`outputSchemas.${schema}.label`)}
                </option>
              ))}
            </NativeSelect>
            <p id="assist-output-schema-help" className="text-xs text-muted-foreground">
              {t(`outputSchemas.${aiSchema}.description`)}
            </p>
          </div>

          {aiFailure ? (
            <p role="alert" className="flex items-start gap-1.5 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                {t(`assist.errors.${aiFailure.error}`, {
                  hours: Math.max(1, Math.ceil((aiFailure.retryAfter ?? 3600) / 3600)),
                })}
              </span>
            </p>
          ) : null}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p id="assist-status" aria-live="polite" className="text-xs text-muted-foreground">
              {pending ? t("assist.pending") : t("assist.quota", { limit: dailyLimit })}
            </p>
            <Button type="submit" shape="pill" disabled={pending} className="shrink-0">
              <Sparkles aria-hidden="true" />
              {t("assist.submit")}
            </Button>
          </div>
        </form>
      )}

      <p className="text-sm text-muted-foreground">
        {t("builder.blank")}{" "}
        <button
          type="button"
          onClick={startBlank}
          className="rounded-md font-medium text-foreground underline underline-offset-4 outline-none hover:no-underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("builder.blankAction")}
        </button>
      </p>
    </div>
  );
}

type ModeOptionProps = {
  value: Mode;
  checked: boolean;
  onSelect: (mode: Mode) => void;
  label: string;
  help: string;
  disabled?: boolean;
  icon?: ReactNode;
};

function ModeOption({ value, checked, onSelect, label, help, disabled, icon }: ModeOptionProps) {
  const id = `builder-mode-${value}`;
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-xl border bg-card p-4 shadow-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
        checked ? "border-highlight/50 bg-highlight/[0.06]" : "hover:bg-muted/50",
        disabled && "cursor-not-allowed opacity-60 hover:bg-card",
      )}
    >
      <input
        id={id}
        type="radio"
        name="builder-mode"
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onSelect(value)}
        // Named by the option alone; the help is read as its description.
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-help`}
        className="mt-1 size-4 shrink-0 accent-highlight"
      />
      <span className="min-w-0">
        <span id={`${id}-label`} className="flex items-center gap-1.5 text-sm font-medium">
          {icon}
          {label}
        </span>
        <span id={`${id}-help`} className="mt-0.5 block text-xs text-muted-foreground">
          {help}
        </span>
      </span>
    </label>
  );
}

type ChoicesProps<V extends string> = {
  name: string;
  legend: string;
  options: { value: V; label: string }[];
  value: V;
  onChange: (value: V) => void;
  error?: string;
};

function Choices<V extends string>({ name, legend, options, value, onChange, error }: ChoicesProps<V>) {
  return (
    <fieldset aria-describedby={error ? `builder-${name}-error` : undefined}>
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="mt-2 space-y-2">
        {options.map((option) => {
          const id = `builder-${name}-${option.value}`;
          return (
            <div key={option.value} className="flex items-start gap-2">
              <input
                id={id}
                type="radio"
                name={`builder-${name}`}
                value={option.value}
                checked={value === option.value}
                onChange={() => onChange(option.value)}
                className="mt-0.5 size-4 shrink-0 accent-highlight"
              />
              <label htmlFor={id} className="text-sm">
                {option.label}
              </label>
            </div>
          );
        })}
      </div>
      <div className="mt-1">
        <FieldError id={`builder-${name}-error`} message={error} />
      </div>
    </fieldset>
  );
}
