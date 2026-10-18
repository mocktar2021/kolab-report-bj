"use client";

import {
  Component,
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Check, Eye, PencilLine, RotateCcw } from "lucide-react";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { insertBlock, sectionImageMarkdown, transferredFiles } from "@/lib/deliverables/section-images";
import { MAX_SECTION_CONTENT } from "@/lib/sections";
import { useUnsavedWork } from "@/lib/unsaved-work";
import { cn } from "@/lib/utils";
import {
  saveSectionContent,
  type SaveSectionContentResult,
  type SectionContentVersion,
} from "./content-actions";
import { ContentCompare } from "./content-compare";
import { useImageInsertTarget, type SectionImageRef } from "./image-insert";
import { ImageUploadList, useImageUploads } from "./image-uploads";
import type { ImagePlace, RichTextControl } from "./rich-text-editor";
import { SectionContent } from "./section-content";

// Hand editing of the section's text (Story KRB-18). The editor keeps the
// version its text started from and sends it back on save: if someone saved
// in between, the server refuses and returns the saved text to compare.
//
// Two modes (KRB-197): "Texte", a Word-like editor, and "Markdown", the
// source. Both edit the same Markdown, which is what gets saved. The Texte
// editor and its libraries load only when the editor opens.
//
// Images (KRB-216): a PNG or JPEG pasted or dropped in either tab is uploaded
// as a deliverable of the section, then goes in the text where it was put.
// "Insérer dans le texte" in the deliverable list puts one at the cursor, and
// opens the editor first when it is closed.

// Hover, focus and opening all start the load, so they share one promise.
// Vitest also needs it: a vi.mock only applies to the first of several imports
// of a module in flight at once. A failed load is dropped so the next try
// starts again.
let richTextEditorLoad: Promise<typeof import("./rich-text-editor")> | undefined;
const loadRichTextEditor = () =>
  (richTextEditorLoad ??= import("./rich-text-editor").catch((error: unknown) => {
    richTextEditorLoad = undefined;
    throw error;
  }));

const RichTextEditor = dynamic(() => loadRichTextEditor().then((module) => module.RichTextEditor), {
  ssr: false,
  loading: EditorLoading,
});

function EditorLoading() {
  const t = useTranslations("SectionEditor.visual");
  return (
    <div className="flex min-h-[22.75rem] items-center justify-center rounded-lg border bg-card text-sm text-muted-foreground">
      <p role="status">{t("loading")}</p>
    </div>
  );
}

/**
 * Shows `fallback` when the Texte editor fails, for example when its code
 * can't load offline or after a deploy, instead of the route's error page:
 * the text stays here and the Markdown tab still works.
 */
class EditorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export type EditorMode = "text" | "markdown";

const MODES: readonly EditorMode[] = ["text", "markdown"];

/** localStorage key of the last mode used on this device, next to kolabreport:theme. */
export const EDITOR_MODE_STORAGE_KEY = "kolabreport:section-editor-mode";

function storedMode(): EditorMode {
  try {
    return window.localStorage.getItem(EDITOR_MODE_STORAGE_KEY) === "markdown" ? "markdown" : "text";
  } catch {
    return "text";
  }
}

function storeMode(mode: EditorMode) {
  try {
    window.localStorage.setItem(EDITOR_MODE_STORAGE_KEY, mode);
  } catch {
    // Storage unavailable, for example in private browsing: the choice lasts until the page closes.
  }
}

type SaveError = Exclude<Extract<SaveSectionContentResult, { ok: false }>["error"], "conflict">;

/** What the status line says after an action. */
type Notice = "saved" | "cleared" | "kept" | "restored" | "imageInserted";

/** The saved text the server sent back on a conflict. `again`: the overwrite conflicted too. */
type Conflict = SectionContentVersion & { again: boolean };

type FocusTarget = "edit" | "title" | "textarea" | "conflict" | "tab";

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
  const [mode, setMode] = useState<EditorMode>("text");
  // A new key loads the Texte editor again, after the text changed from outside it.
  const [visualKey, setVisualKey] = useState(0);
  // The Texte editor takes the focus once it is ready.
  const [visualFocus, setVisualFocus] = useState<boolean | "end">(false);
  const [preview, setPreview] = useState(false);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [error, setError] = useState<SaveError | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, startTransition] = useTransition();

  const editRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const tabRefs = useRef<Record<EditorMode, HTMLButtonElement | null>>({ text: null, markdown: null });
  const conflictRef = useRef<HTMLHeadingElement>(null);
  const focusNext = useRef<FocusTarget | null>(null);
  const visualControl = useRef<RichTextControl | null>(null);
  // Where the cursor goes in the textarea once the text shows an inserted image.
  const textareaCaret = useRef<number | null>(null);

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
      // After a Ctrl+S save the text is the same: the Texte editor keeps its cursor.
      if (text !== (content ?? "")) {
        setText(content ?? "");
        setVisualKey((key) => key + 1);
      }
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
    else if (target === "textarea") {
      textareaRef.current?.focus();
      const caret = textareaCaret.current;
      textareaCaret.current = null;
      if (caret !== null) textareaRef.current?.setSelectionRange(caret, caret);
    } else if (target === "tab") tabRefs.current[mode]?.focus();
    else conflictRef.current?.focus();
  });

  /**
   * Puts the image in the text: at `place` in the Texte tab, after the
   * cursor in the Markdown tab. An upload that ends after the editor closed
   * leaves the file in the deliverable list only.
   */
  function insertImage(image: SectionImageRef, place: ImagePlace | null) {
    if (!editing) return;
    const markdown = sectionImageMarkdown(image.id, image.caption);
    const control = visualControl.current;
    const area = textareaRef.current;
    if (mode === "text" && control) {
      control.insertImage(image, place);
    } else if (mode === "markdown" && area) {
      const next = insertBlock(area.value, area.selectionEnd, area.selectionEnd, markdown);
      setText(next.text);
      setPreview(false);
      textareaCaret.current = next.cursor;
      focusNext.current = "textarea";
    } else {
      // The Texte editor is still loading: the image goes at the end and the editor reads the text again.
      replaceText(insertBlock(text, text.length, text.length, markdown).text);
    }
    setNotice("imageInserted");
  }

  const images = useImageUploads(sectionId, insertImage);

  // "Insérer dans le texte" in the deliverable list.
  useImageInsertTarget((image) => {
    if (pending) return;
    if (editing) {
      insertImage(image, null);
      return;
    }
    const current = base.content ?? "";
    const markdown = sectionImageMarkdown(image.id, image.caption);
    open(insertBlock(current, current.length, current.length, markdown).text, "end");
    setNotice("imageInserted");
  });

  // Leaving the page would lose the changes or cut an upload short. The update banner waits too.
  useUnsavedWork(dirty || images.busy);

  function adopt(next: SectionContentVersion) {
    setKnown(next);
    setBase(next);
  }

  /**
   * The text field of the mode takes the focus: the textarea now, the Texte
   * editor once it is ready. "end" puts the cursor after the text.
   */
  function focusField(fieldMode: EditorMode, at: "start" | "end" = "start") {
    if (fieldMode === "markdown") {
      focusNext.current = "textarea";
      if (at === "end") textareaCaret.current = Number.MAX_SAFE_INTEGER;
    } else {
      setVisualFocus(at === "end" ? "end" : true);
    }
  }

  const onVisualFocused = useCallback(() => setVisualFocus(false), []);

  /** Replaces the text from outside the Texte editor, which then reads it again. */
  function replaceText(next: string) {
    setText(next);
    setVisualKey((key) => key + 1);
  }

  /** `at` "end" for an image added to the end of the text, where the cursor then goes. */
  function open(initial = base.content ?? "", at: "start" | "end" = "start") {
    const lastMode = storedMode();
    replaceText(initial);
    setMode(lastMode);
    setEditing(true);
    setPreview(false);
    setConflict(null);
    setError(null);
    setNotice(null);
    focusField(lastMode, at);
  }

  function switchMode(next: EditorMode) {
    if (next === mode) return;
    setMode(next);
    storeMode(next);
    setVisualFocus(false);
  }

  /** From a notice in the Texte tab: the Markdown tab, with the focus on it. */
  function showMarkdown() {
    switchMode("markdown");
    focusNext.current = "tab";
  }

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    const index = MODES.indexOf(mode);
    const next =
      event.key === "ArrowRight"
        ? MODES[(index + 1) % MODES.length]
        : event.key === "ArrowLeft"
          ? MODES[(index - 1 + MODES.length) % MODES.length]
          : event.key === "Home"
            ? MODES[0]
            : event.key === "End"
              ? MODES[MODES.length - 1]
              : undefined;
    if (!next) return;
    event.preventDefault();
    switchMode(next);
    tabRefs.current[next]?.focus();
  }

  function cancel() {
    if (pending) return;
    // The editor may know a newer text than the one it started from.
    setBase(known);
    setEditing(false);
    setConflict(null);
    setError(null);
    setVisualFocus(false);
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
    replaceText(saved.content ?? "");
    setConflict(null);
    setError(null);
    setPreview(false);
    setNotice("restored");
    focusField(mode);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Ctrl+Shift+S is strikethrough in the Texte editor.
    if (event.nativeEvent.isComposing || event.altKey || event.shiftKey) return;
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
    event.preventDefault();
    // During a conflict, saving means choosing a version first.
    if (conflict) conflictRef.current?.focus();
    else save(base.version, "saved", false);
  }

  const textareaId = `${id}-text`;
  const visualLabelId = `${id}-visual-label`;
  const panelId = `${id}-panel`;
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
        <Button
          ref={editRef}
          type="button"
          variant="outline"
          size="sm"
          shape="pill"
          onClick={() => open()}
          // Starts loading the Texte editor before the click.
          onPointerEnter={() => void loadRichTextEditor()}
          onFocus={() => void loadRichTextEditor()}
        >
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
              <div
                role="tablist"
                aria-label={t("modes")}
                className="inline-flex rounded-lg border bg-muted/40 p-0.5"
              >
                {MODES.map((value) => (
                  <button
                    key={value}
                    ref={(element) => {
                      tabRefs.current[value] = element;
                    }}
                    type="button"
                    role="tab"
                    id={`${id}-tab-${value}`}
                    aria-selected={mode === value}
                    aria-controls={panelId}
                    tabIndex={mode === value ? 0 : -1}
                    onClick={() => switchMode(value)}
                    onKeyDown={onTabKey}
                    className={cn(
                      "min-h-9 rounded-md px-3 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0",
                      mode === value
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {value === "text" ? t("modeText") : t("modeMarkdown")}
                  </button>
                ))}
              </div>
              {mode === "markdown" ? (
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
              ) : null}
            </div>
            <div role="tabpanel" id={panelId} aria-labelledby={`${id}-tab-${mode}`} className="space-y-1.5">
              {mode === "text" ? (
                <>
                  <p id={visualLabelId} className="text-sm font-medium">
                    {t("visual.label")}
                  </p>
                  <EditorBoundary
                    key={visualKey}
                    fallback={
                      <div className="flex min-h-[20rem] flex-col items-start gap-3 rounded-lg border border-dashed px-4 py-3 text-sm">
                        <p role="alert">{t("visual.loadError")}</p>
                        <Button type="button" size="sm" variant="outline" onClick={showMarkdown}>
                          {t("visual.showMarkdown")}
                        </Button>
                      </div>
                    }
                  >
                    <RichTextEditor
                      initialMarkdown={text}
                      onChange={(markdown) => {
                        setText(markdown);
                        setNotice(null);
                      }}
                      labelledBy={visualLabelId}
                      describedBy={helpId}
                      invalid={tooLong}
                      readOnly={pending}
                      autoFocus={visualFocus}
                      onAutoFocused={onVisualFocused}
                      onShowMarkdown={showMarkdown}
                      onFiles={images.add}
                      control={visualControl}
                    />
                  </EditorBoundary>
                </>
              ) : (
                <>
                  <label htmlFor={textareaId} className="block text-sm font-medium">
                    {t("label")}
                  </label>
                  <textarea
                    id={textareaId}
                    ref={textareaRef}
                    value={text}
                    hidden={preview}
                    onChange={(event) => {
                      setText(event.target.value);
                      setNotice(null);
                    }}
                    onPaste={(event) => {
                      const files = transferredFiles(event.clipboardData);
                      if (!files) return;
                      event.preventDefault();
                      images.add(files.map((file) => ({ file, place: null })));
                    }}
                    onDragOver={(event) => {
                      // Without this, the browser opens a dropped file in place of the page.
                      if (event.dataTransfer.types.includes("Files")) event.preventDefault();
                    }}
                    onDrop={(event) => {
                      const files = transferredFiles(event.dataTransfer);
                      if (!files) return;
                      event.preventDefault();
                      images.add(files.map((file) => ({ file, place: null })));
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
                          images="deliverables"
                          fallback={<p className="text-destructive">{t("previewError")}</p>}
                        >
                          {text}
                        </Markdown>
                      ) : (
                        <p className="text-muted-foreground">{t("previewEmpty")}</p>
                      )
                    ) : null}
                  </div>
                </>
              )}
            </div>
            <p id={helpId} className="flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground">
              <span className={tooLong ? "text-destructive" : undefined}>
                {tooLong
                  ? t("tooLong", { max: MAX_SECTION_CONTENT })
                  : mode === "text"
                    ? t("visual.help")
                    : t("help")}
              </span>
              {text.length >= COUNT_FROM ? (
                <span className={cn("tabular-nums", tooLong && "text-destructive")}>
                  {t("count", { count: text.length, max: MAX_SECTION_CONTENT })}
                </span>
              ) : null}
            </p>
            <ImageUploadList uploads={images.uploads} onDismiss={images.dismiss} />
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
