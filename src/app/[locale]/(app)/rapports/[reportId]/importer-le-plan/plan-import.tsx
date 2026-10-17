"use client";

import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, ChevronDown, FileUp, LoaderCircle, Merge, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";
import { useRouter } from "@/i18n/navigation";
import {
  FILE_NAME_HEADER,
  type PlanImportErrorBody,
  type PlanImportErrorKey,
  type PlanImportErrorValues,
  type PlanReadBody,
} from "@/lib/plan/errors";
import { PLAN_LIMITS, type PlanLevel, type PlanSource } from "@/lib/plan/types";
import { renumber } from "@/lib/section-outline";
import { cn } from "@/lib/utils";
import { importPlan, type ImportPlanErrorKey } from "./actions";

const FILE_EXTENSIONS = [".docx", ".txt", ".md"];

const TEXTAREA =
  "flex w-full rounded-lg border border-input bg-card px-3 py-2 text-base shadow-sm transition-[border-color,box-shadow] duration-200 placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15 aria-[invalid=true]:border-destructive md:text-sm";

type ReadError = { key: PlanImportErrorKey; values?: PlanImportErrorValues };

type Row = { id: string; title: string; level: PlanLevel; instructions: string; open: boolean };

type Preview = { rows: Row[]; source: PlanSource; truncated: boolean };

/**
 * Reads a plan from a file or pasted text, shows it for review, then creates
 * the sections (KRB-196). Nothing is created before "Créer les N sections".
 */
export function PlanImport({ reportId, pdfEnabled }: { reportId: string; pdfEnabled: boolean }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const nextId = useRef(0);

  const show = (plan: PlanReadBody) =>
    setPreview({
      source: plan.source,
      truncated: plan.truncated,
      rows: plan.items.map((item) => ({ ...item, id: `element-${(nextId.current += 1)}`, open: false })),
    });

  return preview ? (
    <PlanPreview
      reportId={reportId}
      preview={preview}
      onChange={setPreview}
      onRestart={() => setPreview(null)}
    />
  ) : (
    <PlanSourceForm reportId={reportId} pdfEnabled={pdfEnabled} onPlan={show} />
  );
}

async function readPlan(reportId: string, body: File | string): Promise<PlanReadBody | ReadError> {
  const file = typeof body !== "string";
  try {
    const response = await fetch(`/api/reports/${reportId}/plan`, {
      method: "POST",
      headers: file
        ? { "Content-Type": "application/octet-stream", [FILE_NAME_HEADER]: encodeURIComponent(body.name) }
        : { "Content-Type": "application/json" },
      body: file ? body : JSON.stringify({ text: body }),
    });
    const data: unknown = await response.json().catch(() => null);
    if (response.ok && data && typeof data === "object" && "items" in data) return data as PlanReadBody;
    const error = (data as PlanImportErrorBody | null)?.error;
    return { key: error ?? "generic", values: (data as PlanImportErrorBody | null)?.values };
  } catch {
    return { key: "network" as PlanImportErrorKey };
  }
}

function PlanSourceForm({
  reportId,
  pdfEnabled,
  onPlan,
}: {
  reportId: string;
  pdfEnabled: boolean;
  onPlan: (plan: PlanReadBody) => void;
}) {
  const t = useTranslations("PlanImport");
  const [busy, setBusy] = useState<"file" | "text" | "pdf" | null>(null);
  const [error, setError] = useState<{ from: "file" | "text"; error: ReadError } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const accept = [...FILE_EXTENSIONS, ...(pdfEnabled ? [".pdf"] : [])].join(",");

  async function read(from: "file" | "text", body: File | string) {
    setError(null);
    setBusy(from === "file" && typeof body !== "string" && /\.pdf$/i.test(body.name) ? "pdf" : from);
    const result = await readPlan(reportId, body);
    setBusy(null);
    if ("items" in result) onPlan(result);
    else {
      setError({ from, error: result });
      (from === "file" ? fileRef : textRef).current?.focus();
    }
  }

  function submitFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError({ from: "file", error: { key: "fileType" } });
      fileRef.current?.focus();
      return;
    }
    const name = file.name.toLowerCase();
    const known = [...FILE_EXTENSIONS, ".pdf"].some((extension) => name.endsWith(extension));
    const problem: PlanImportErrorKey | null = !known
      ? "fileType"
      : name.endsWith(".pdf") && !pdfEnabled
        ? "aiUnavailable"
        : file.size === 0
          ? "fileEmpty"
          : file.size > PLAN_LIMITS.maxFileBytes
            ? "fileTooLarge"
            : null;
    if (problem) {
      setError({ from: "file", error: { key: problem } });
      fileRef.current?.focus();
      return;
    }
    void read("file", file);
  }

  function submitText(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const text = textRef.current?.value ?? "";
    const problem =
      text.trim() === "" ? "textEmpty" : text.length > PLAN_LIMITS.maxTextChars ? "textTooLong" : null;
    if (problem) {
      setError({ from: "text", error: { key: problem } });
      textRef.current?.focus();
      return;
    }
    void read("text", text);
  }

  const message = (from: "file" | "text") =>
    error?.from === from ? t(`errors.${error.error.key}`, error.error.values ?? {}) : null;
  const fileError = message("file");
  const textError = message("text");

  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-2">
      <form
        onSubmit={submitFile}
        noValidate
        aria-labelledby={`${id}-file-title`}
        className="surface-card rounded-2xl border p-5 shadow-sm"
      >
        <h2 id={`${id}-file-title`} className="font-medium">
          {t("fileTitle")}
        </h2>
        <Label htmlFor={`${id}-file`} className="mt-4 block">
          {t("fileLabel")}
        </Label>
        <input
          ref={fileRef}
          id={`${id}-file`}
          name="plan"
          type="file"
          accept={accept}
          className="mt-2 block w-full cursor-pointer rounded-lg border border-input bg-card text-sm shadow-sm file:mr-3 file:cursor-pointer file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm file:font-medium focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15"
          aria-invalid={Boolean(fileError)}
          aria-describedby={`${id}-file-help${fileError ? ` ${id}-file-error` : ""}`}
          onChange={() => setError(null)}
        />
        <div id={`${id}-file-help`} className="mt-2 space-y-1 text-xs text-muted-foreground">
          <p>{pdfEnabled ? t("fileHelp") : t("fileHelpNoPdf")}</p>
          <p>{pdfEnabled ? t("pdfNote") : t("pdfOff")}</p>
        </div>
        {fileError ? (
          <p id={`${id}-file-error`} role="alert" className="mt-3 text-sm text-destructive">
            {fileError}
          </p>
        ) : null}
        <Button type="submit" shape="pill" className="mt-4" disabled={busy !== null}>
          {busy === "file" || busy === "pdf" ? (
            <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" />
          ) : (
            <FileUp aria-hidden="true" />
          )}
          {t("fileSubmit")}
        </Button>
      </form>

      <form
        onSubmit={submitText}
        noValidate
        aria-labelledby={`${id}-text-title`}
        className="surface-card rounded-2xl border p-5 shadow-sm"
      >
        <h2 id={`${id}-text-title`} className="font-medium">
          {t("pasteTitle")}
        </h2>
        <Label htmlFor={`${id}-text`} className="mt-4 block">
          {t("pasteLabel")}
        </Label>
        <textarea
          ref={textRef}
          id={`${id}-text`}
          name="text"
          rows={8}
          placeholder={t("pastePlaceholder")}
          className={cn(TEXTAREA, "mt-2 font-mono")}
          aria-invalid={Boolean(textError)}
          aria-describedby={`${id}-text-help${textError ? ` ${id}-text-error` : ""}`}
          onChange={() => (error?.from === "text" ? setError(null) : undefined)}
        />
        <p id={`${id}-text-help`} className="mt-2 text-xs text-muted-foreground">
          {t("pasteHelp")}
        </p>
        {textError ? (
          <p id={`${id}-text-error`} role="alert" className="mt-3 text-sm text-destructive">
            {textError}
          </p>
        ) : null}
        <Button type="submit" shape="pill" variant="outline" className="mt-4" disabled={busy !== null}>
          {busy === "text" ? <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" /> : null}
          {t("pasteSubmit")}
        </Button>
      </form>

      <p role="status" aria-live="polite" className="text-sm text-muted-foreground lg:col-span-2">
        {busy === "pdf" ? t("readingPdf") : busy ? t("reading") : null}
      </p>
    </div>
  );
}

type Focus =
  { id: string; target: "title" | "up" | "down" | "instructions" } | { id: "restart"; target: "restart" };

function PlanPreview({
  reportId,
  preview,
  onChange,
  onRestart,
}: {
  reportId: string;
  preview: Preview;
  onChange: (preview: Preview) => void;
  onRestart: () => void;
}) {
  const t = useTranslations("PlanImport");
  const router = useRouter();
  const [announcement, setAnnouncement] = useState("");
  const [invalid, setInvalid] = useState<Record<string, "titleRequired" | "instructionsTooLong">>({});
  const [createError, setCreateError] = useState<ImportPlanErrorKey | "fixItems" | null>(null);
  const [creating, startCreating] = useTransition();
  const [focus, setFocus] = useState<Focus | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const restartRef = useRef<HTMLButtonElement>(null);
  const elements = useRef(new Map<string, HTMLElement>());
  const rows = preview.rows;
  const numbered = renumber(rows);
  const sections = rows.filter((row) => row.level === 1).length;

  // The preview takes the focus when it opens, so screen readers start at its title.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // Each request is a new object, so the effect runs once per request.
  useEffect(() => {
    if (!focus) return;
    if (focus.target === "restart") restartRef.current?.focus();
    else elements.current.get(`${focus.id}:${focus.target}`)?.focus();
  }, [focus]);

  const register = (key: string) => (element: HTMLElement | null) => {
    if (element) elements.current.set(key, element);
    else elements.current.delete(key);
  };

  /** New rows, with the first one always a section. */
  function update(next: Row[]) {
    const first = next[0];
    onChange({
      ...preview,
      rows: first && first.level === 2 ? [{ ...first, level: 1 }, ...next.slice(1)] : next,
    });
    setCreateError(null);
  }

  const name = (row: Row) => row.title.trim() || t("untitled");

  function edit(id: string, change: Partial<Row>) {
    update(rows.map((row) => (row.id === id ? { ...row, ...change } : row)));
    if (invalid[id]) {
      setInvalid((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    }
  }

  function move(index: number, by: -1 | 1) {
    const target = index + by;
    const row = rows[index];
    if (!row || target < 0 || target >= rows.length) return;
    const next = [...rows];
    next.splice(index, 1);
    next.splice(target, 0, row);
    update(next);
    setFocus({ id: row.id, target: by < 0 ? "up" : "down" });
    setAnnouncement(t("announce.moved", { title: name(row), position: target + 1, count: rows.length }));
  }

  function remove(index: number) {
    const row = rows[index];
    if (!row) return;
    const next = rows.filter((_, position) => position !== index);
    update(next);
    const neighbour = next[index] ?? next[index - 1];
    setFocus(neighbour ? { id: neighbour.id, target: "title" } : { id: "restart", target: "restart" });
    setAnnouncement(t("announce.removed", { title: name(row) }));
  }

  /** The item's title and instructions go into the instructions of the one before it. */
  function merge(index: number) {
    const row = rows[index];
    const previous = rows[index - 1];
    if (!row || !previous) return;
    const instructions = [previous.instructions.trim(), row.title.trim(), row.instructions.trim()]
      .filter(Boolean)
      .join("\n\n");
    update(
      rows.flatMap((item, position) =>
        position === index ? [] : position === index - 1 ? [{ ...item, instructions, open: true }] : [item],
      ),
    );
    setFocus({ id: previous.id, target: "instructions" });
    setAnnouncement(t("announce.merged", { title: name(row), previous: name(previous) }));
  }

  function changeLevel(row: Row, level: PlanLevel) {
    edit(row.id, { level });
    setAnnouncement(t("announce.level", { title: name(row), level: level === 1 ? "section" : "subsection" }));
  }

  function create() {
    const problems: Record<string, "titleRequired" | "instructionsTooLong"> = {};
    for (const row of rows) {
      if (!row.title.trim()) problems[row.id] = "titleRequired";
      else if (row.instructions.trim().length > PLAN_LIMITS.maxInstructionsChars)
        problems[row.id] = "instructionsTooLong";
    }
    setInvalid(problems);
    const firstProblem = rows.find((row) => problems[row.id]);
    if (firstProblem) {
      setCreateError("fixItems");
      if (problems[firstProblem.id] === "instructionsTooLong") {
        update(rows.map((row) => (row.id === firstProblem.id ? { ...row, open: true } : row)));
        setFocus({ id: firstProblem.id, target: "instructions" });
      } else setFocus({ id: firstProblem.id, target: "title" });
      return;
    }
    setCreateError(null);
    startCreating(async () => {
      const result = await importPlan(
        reportId,
        rows.map((row) => ({
          title: row.title.trim(),
          level: row.level,
          instructions: row.instructions.trim(),
        })),
      );
      if (result.ok) router.push(`/rapports/${reportId}`);
      else setCreateError(result.error);
    });
  }

  return (
    <section aria-labelledby="plan-preview-title" className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id="plan-preview-title" ref={headingRef} tabIndex={-1} className="text-h3 outline-none">
            {t("previewTitle")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("summary", { count: rows.length, sections, subsections: rows.length - sections })}
          </p>
        </div>
        <Button ref={restartRef} type="button" variant="outline" shape="pill" size="sm" onClick={onRestart}>
          {t("restart")}
        </Button>
      </div>
      <div className="mt-3 space-y-1 text-sm text-muted-foreground">
        <p>{t(`source.${preview.source}`)}</p>
        {preview.truncated ? <p className="text-foreground">{t("truncated")}</p> : null}
        <p>{t("previewHelp")}</p>
      </div>

      {rows.length === 0 ? (
        <p className="surface-card mt-6 rounded-2xl border px-5 py-10 text-center text-sm text-muted-foreground shadow-sm">
          {t("emptyPlan")}
        </p>
      ) : (
        <ol
          aria-label={t("listLabel")}
          className="surface-card mt-6 divide-y overflow-hidden rounded-2xl border shadow-sm"
        >
          {rows.map((row, index) => {
            const label = numbered[index]?.label ?? "";
            const problem = invalid[row.id];
            const titleId = `${row.id}-title`;
            const instructionsId = `${row.id}-instructions`;
            const errorId = `${row.id}-error`;
            const sub = row.level === 2;
            return (
              <li key={row.id} className={cn("py-4 pr-4", sub ? "pl-8 sm:pl-14" : "pl-4 sm:pl-5")}>
                <div className="flex items-start gap-3">
                  <span className="mt-2 w-9 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                    {label}
                  </span>
                  <div className="min-w-0 flex-1">
                    <label htmlFor={titleId} className="sr-only">
                      {t("itemTitle", { label })}
                    </label>
                    <Input
                      id={titleId}
                      ref={register(`${row.id}:title`)}
                      value={row.title}
                      maxLength={PLAN_LIMITS.maxTitleChars}
                      onChange={(event) => edit(row.id, { title: event.target.value })}
                      className={cn("h-9", !sub && "font-medium")}
                      aria-invalid={problem === "titleRequired"}
                      aria-describedby={problem ? errorId : undefined}
                    />
                    {problem ? (
                      <p id={errorId} className="mt-1 text-sm text-destructive">
                        {t(problem)}
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <NativeSelect
                        aria-label={t("itemLevel", { label })}
                        value={String(row.level)}
                        onChange={(event) => changeLevel(row, event.target.value === "2" ? 2 : 1)}
                        disabled={index === 0}
                        title={index === 0 ? t("firstIsSection") : undefined}
                        className="w-40"
                        selectClassName="h-8 text-xs"
                      >
                        <option value="1">{t("levelSection")}</option>
                        <option value="2">{t("levelSubsection")}</option>
                      </NativeSelect>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-expanded={row.open}
                        aria-controls={instructionsId}
                        onClick={() => edit(row.id, { open: !row.open })}
                      >
                        <ChevronDown
                          className={cn(
                            "transition-transform motion-reduce:transition-none",
                            row.open && "rotate-180",
                          )}
                          aria-hidden="true"
                        />
                        {t("instructions")}
                        <span className="font-normal text-muted-foreground">
                          ({t("instructionsCount", { count: row.instructions.trim().length })})
                        </span>
                      </Button>
                      <div className="ml-auto flex items-center gap-1">
                        <IconButton
                          ref={register(`${row.id}:up`)}
                          label={t("moveUp", { title: name(row) })}
                          disabled={index === 0}
                          onClick={() => move(index, -1)}
                        >
                          <ArrowUp aria-hidden="true" />
                        </IconButton>
                        <IconButton
                          ref={register(`${row.id}:down`)}
                          label={t("moveDown", { title: name(row) })}
                          disabled={index === rows.length - 1}
                          onClick={() => move(index, 1)}
                        >
                          <ArrowDown aria-hidden="true" />
                        </IconButton>
                        <IconButton
                          label={t("merge", { title: name(row) })}
                          disabled={index === 0}
                          onClick={() => merge(index)}
                        >
                          <Merge aria-hidden="true" />
                        </IconButton>
                        <IconButton label={t("remove", { title: name(row) })} onClick={() => remove(index)}>
                          <Trash2 aria-hidden="true" />
                        </IconButton>
                      </div>
                    </div>
                    <div id={instructionsId} hidden={!row.open} className="mt-3">
                      <label htmlFor={`${instructionsId}-text`} className="text-xs font-medium">
                        {t("instructionsLabel", { label })}
                      </label>
                      <textarea
                        id={`${instructionsId}-text`}
                        ref={register(`${row.id}:instructions`)}
                        value={row.instructions}
                        rows={4}
                        onChange={(event) => edit(row.id, { instructions: event.target.value })}
                        className={cn(TEXTAREA, "mt-1.5")}
                        aria-invalid={problem === "instructionsTooLong"}
                        aria-describedby={`${instructionsId}-help${problem ? ` ${errorId}` : ""}`}
                      />
                      <p id={`${instructionsId}-help`} className="mt-1 text-xs text-muted-foreground">
                        {t("instructionsHelp")}
                      </p>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button type="button" shape="pill" onClick={create} disabled={creating || rows.length === 0}>
          {creating ? <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" /> : null}
          {creating ? t("creating") : t("create", { count: rows.length })}
        </Button>
        {createError ? (
          <p role="alert" className="text-sm text-destructive">
            {createError === "fixItems" ? t("fixItems") : t(`createErrors.${createError}`)}
          </p>
        ) : null}
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </section>
  );
}

/**
 * A small button with its name for screen readers only. aria-disabled
 * rather than disabled, so the focus stays on it when it can no longer act
 * (the first row can't move up).
 */
function IconButton({
  ref,
  label,
  disabled = false,
  onClick,
  children,
}: {
  ref?: (element: HTMLButtonElement | null) => void;
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      size="icon"
      className="size-8 aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
      aria-label={label}
      title={label}
      aria-disabled={disabled}
      onClick={() => {
        if (!disabled) onClick();
      }}
    >
      {children}
    </Button>
  );
}
