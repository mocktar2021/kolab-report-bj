"use client";

import {
  useDeferredValue,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
} from "react";
import { useTranslations } from "next-intl";
import { Check, Eye, PencilLine, RotateCcw } from "lucide-react";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { MAX_SECTION_CONTENT } from "@/lib/sections";
import { useUnsavedWork } from "@/lib/unsaved-work";
import { cn } from "@/lib/utils";
import {
  saveSectionContent,
  type SaveSectionContentResult,
  type SectionContentVersion,
} from "./content-actions";
import { ContentCompare } from "./content-compare";
import { SectionContent } from "./section-content";

// Hand editing of the section's text (Story KRB-18). The editor keeps the
// version its text started from and sends it back on save: if someone saved
// in between, the server refuses and returns the saved text to compare.

type SaveError = Exclude<Extract<SaveSectionContentResult, { ok: false }>["error"], "conflict">;

/** What the status line says after an action. */
type Notice = "saved" | "cleared" | "kept" | "restored";

/** The saved text the server sent back on a conflict. `again`: the overwrite conflicted too. */
type Conflict = SectionContentVersion & { again: boolean };

type FocusTarget = "edit" | "title" | "textarea" | "conflict";

/** The counter shows from this length on. */
const COUNT_FROM = Math.floor(MAX_SECTION_CONTENT * 0.9);

const textareaClass =
  "flex w-full rounded-lg border border-input bg-card px-3 py-2 text-base shadow-sm transition-[border-color,box-shadow] duration-200 placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15 aria-[invalid=true]:border-destructive md:text-sm";

/** Buttons stay focusable while a save runs, so the focus isn't lost. */
const busyClass = "aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

type SectionEditorProps = {
  sectionId: string;
  content: string | null;
  /** content_updated_at exactly as Supabase returned it, sent back as is on save. */
  version: string;
  /** For editors who can ask for a draft: the empty state says it can start the section. */
  draftHint: boolean;
};

/** The section's text with an editor, for the assigned expert and managers. */
export function SectionEditor({ sectionId, content, version, draftHint }: SectionEditorProps) {
  const t = useTranslations("SectionEditor");
  const id = useId();

  // The page data last seen, to notice when it changes.
  const [seen, setSeen] = useState<SectionContentVersion>({ content, version });
  // The newest saved text this editor knows of.
  const [known, setKnown] = useState<SectionContentVersion>(seen);
  // The saved text the editor's text started from. Its version goes with the save.
  const [base, setBase] = useState<SectionContentVersion>(seen);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState(false);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [error, setError] = useState<SaveError | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, startTransition] = useTransition();

  const editRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const conflictRef = useRef<HTMLHeadingElement>(null);
  const focusNext = useRef<FocusTarget | null>(null);

  const dirty = editing && text !== (base.content ?? "");
  const tooLong = text.length > MAX_SECTION_CONTENT;
  const comparedText = useDeferredValue(text);

  // New page data, for example after a draft was accepted. The editor takes
  // it unless it holds changes of its own: those are compared at save time.
  if (seen.content !== content || seen.version !== version) {
    const next = { content, version };
    setSeen(next);
    setKnown(next);
    if (!editing) {
      setBase(next);
    } else if (!dirty || text === (content ?? "")) {
      setBase(next);
      setText(content ?? "");
      setConflict(null);
    }
  }

  // Focus moves once the screen shows the new state.
  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    if (target === "title") document.getElementById("section-content-title")?.focus();
    else if (target === "edit") editRef.current?.focus();
    else if (target === "textarea") textareaRef.current?.focus();
    else conflictRef.current?.focus();
  });

  // Leaving the page would lose the changes. The update banner waits too.
  useUnsavedWork(dirty);

  function adopt(next: SectionContentVersion) {
    setKnown(next);
    setBase(next);
  }

  function open() {
    setText(base.content ?? "");
    setEditing(true);
    setPreview(false);
    setConflict(null);
    setError(null);
    setNotice(null);
    focusNext.current = "textarea";
  }

  function cancel() {
    if (pending) return;
    // The editor may know a newer text than the one it started from.
    setBase(known);
    setEditing(false);
    setConflict(null);
    setError(null);
    focusNext.current = "edit";
  }

  /** `close`: back to the text once saved. Ctrl+S keeps the editor open. */
  function save(expectedVersion: string, outcome: "saved" | "kept", close: boolean) {
    if (pending || tooLong) return;
    const sent = text;
    setError(null);
    setNotice(null);
    startTransition(async () => {
      let result: SaveSectionContentResult;
      try {
        result = await saveSectionContent({ sectionId, content: sent, expectedVersion });
      } catch {
        // The action did not answer, for example after a network error.
        result = { ok: false, error: "generic" };
      }
      if (result.ok) {
        // Same rule as the server: empty text clears the section.
        adopt({ content: sent.trim() ? sent : null, version: result.version });
        setConflict(null);
        setNotice(outcome === "kept" ? "kept" : sent.trim() ? "saved" : "cleared");
        if (close) {
          setEditing(false);
          focusNext.current = "title";
        }
        return;
      }
      if (result.error === "conflict") {
        const current = result.current;
        setKnown(current);
        setConflict((previous) => ({ ...current, again: previous !== null }));
        focusNext.current = "conflict";
        return;
      }
      // The alert reads it out. The focus stays where it was.
      setError(result.error);
    });
  }

  function restore() {
    if (pending || !conflict) return;
    const saved = { content: conflict.content, version: conflict.version };
    adopt(saved);
    setText(saved.content ?? "");
    setConflict(null);
    setError(null);
    setPreview(false);
    setNotice("restored");
    focusNext.current = "textarea";
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing || event.altKey) return;
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
    event.preventDefault();
    // During a conflict, saving means choosing a version first.
    if (conflict) conflictRef.current?.focus();
    else save(base.version, "saved", false);
  }

  const textareaId = `${id}-text`;
  const helpId = `${id}-help`;
  const conflictTitleId = `${id}-conflict`;
  const keepHelpId = `${id}-keep`;
  const restoreHelpId = `${id}-restore`;
  // The editor runs on a version older than one it saw: saving will compare them.
  const changedMeanwhile = editing && !conflict && known !== base && known.content !== base.content;

  const actions = (
    <>
      <p role="status" className={notice ? "text-sm text-muted-foreground" : "sr-only"}>
        {notice ? t(`notices.${notice}`) : null}
      </p>
      {editing ? null : (
        <Button ref={editRef} type="button" variant="outline" size="sm" shape="pill" onClick={open}>
          <PencilLine aria-hidden="true" />
          {t("edit")}
        </Button>
      )}
    </>
  );

  return (
    <SectionContent content={base.content} draftHint={draftHint} actions={actions}>
      {editing ? (
        <div className="space-y-4 px-5 py-4" onKeyDown={onKeyDown}>
          {conflict ? (
            <section
              aria-labelledby={conflictTitleId}
              className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3"
            >
              <div className="text-sm">
                <h3
                  id={conflictTitleId}
                  ref={conflictRef}
                  tabIndex={-1}
                  className="rounded-sm font-medium text-destructive outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t("conflict.title")}
                </h3>
                <p className="mt-1">{t("conflict.body")}</p>
                {conflict.again ? <p className="mt-1">{t("conflict.again")}</p> : null}
              </div>
              <ContentCompare mine={comparedText} saved={conflict.content ?? ""} />
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Button
                    type="button"
                    size="sm"
                    shape="pill"
                    aria-disabled={pending || tooLong || undefined}
                    aria-describedby={tooLong ? `${keepHelpId} ${helpId}` : keepHelpId}
                    className={busyClass}
                    onClick={() => save(conflict.version, "kept", true)}
                  >
                    <Check aria-hidden="true" />
                    {t("conflict.keep")}
                  </Button>
                  <p id={keepHelpId} className="text-xs text-muted-foreground">
                    {t("conflict.keepHelp")}
                  </p>
                </div>
                <div className="space-y-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    shape="pill"
                    aria-disabled={pending || undefined}
                    aria-describedby={restoreHelpId}
                    className={busyClass}
                    onClick={restore}
                  >
                    <RotateCcw aria-hidden="true" />
                    {t("conflict.restore")}
                  </Button>
                  <p id={restoreHelpId} className="text-xs text-muted-foreground">
                    {t("conflict.restoreHelp")}
                  </p>
                </div>
              </div>
            </section>
          ) : null}

          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor={textareaId} className="text-sm font-medium">
                {t("label")}
              </label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-pressed={preview}
                aria-controls={`${textareaId}-preview`}
                onClick={() => setPreview((value) => !value)}
              >
                <Eye aria-hidden="true" />
                {t("preview")}
              </Button>
            </div>
            <textarea
              id={textareaId}
              ref={textareaRef}
              value={text}
              hidden={preview}
              onChange={(event) => {
                setText(event.target.value);
                setNotice(null);
              }}
              rows={16}
              readOnly={pending}
              spellCheck
              className={cn(
                textareaClass,
                "min-h-[20rem] font-mono text-[13px] leading-relaxed md:text-[13px]",
                // The hidden attribute alone loses to the flex class.
                preview && "hidden",
              )}
              aria-invalid={tooLong}
              aria-describedby={helpId}
            />
            <div
              id={`${textareaId}-preview`}
              role="region"
              aria-label={t("preview")}
              hidden={!preview}
              className="min-h-[20rem] break-words rounded-lg border bg-card px-4 py-3 text-sm leading-relaxed"
            >
              {preview ? (
                text.trim() ? (
                  <Markdown
                    headingLevel={3}
                    headings="flatten"
                    links="text"
                    fallback={<p className="text-destructive">{t("previewError")}</p>}
                  >
                    {text}
                  </Markdown>
                ) : (
                  <p className="text-muted-foreground">{t("previewEmpty")}</p>
                )
              ) : null}
            </div>
            <p id={helpId} className="flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground">
              <span className={tooLong ? "text-destructive" : undefined}>
                {tooLong ? t("tooLong", { max: MAX_SECTION_CONTENT }) : t("help")}
              </span>
              {text.length >= COUNT_FROM ? (
                <span className={cn("tabular-nums", tooLong && "text-destructive")}>
                  {t("count", { count: text.length, max: MAX_SECTION_CONTENT })}
                </span>
              ) : null}
            </p>
          </div>

          {changedMeanwhile ? <p className="text-sm text-muted-foreground">{t("changedMeanwhile")}</p> : null}

          {error ? (
            <div
              role="alert"
              className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
            >
              {t(`errors.${error}`)}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            {conflict ? null : (
              <Button
                type="button"
                shape="pill"
                aria-disabled={pending || tooLong || undefined}
                aria-describedby={tooLong ? helpId : undefined}
                aria-keyshortcuts="Control+S Meta+S"
                className={busyClass}
                onClick={() => save(base.version, "saved", true)}
              >
                <Check aria-hidden="true" />
                {t("save")}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              shape="pill"
              aria-disabled={pending || undefined}
              className={busyClass}
              onClick={cancel}
            >
              {t("cancel")}
            </Button>
            <p role="status" className="text-sm text-muted-foreground">
              {pending ? t("saving") : null}
            </p>
          </div>
        </div>
      ) : null}
    </SectionContent>
  );
}
