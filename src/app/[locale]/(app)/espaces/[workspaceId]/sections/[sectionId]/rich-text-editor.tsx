"use client";

import {
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import type { EditorView } from "@tiptap/pm/view";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { useTranslations } from "next-intl";
import {
  Bold,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  type LucideIcon,
  Strikethrough,
  Table as TableIcon,
  TextQuote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { sectionImageMarkdown, sectionImagePath, transferredFiles } from "@/lib/deliverables/section-images";
import {
  bindOrigin,
  docToMarkdown,
  parseMarkdown,
  type MarkdownOrigin,
  type ParsedMarkdown,
} from "@/lib/rich-text/markdown";
import { isSafeHref, richTextExtensions } from "@/lib/rich-text/schema";
import { cn } from "@/lib/utils";

// The "Texte" mode of the section editor (KRB-197): a Word-like editor on top
// of the section's Markdown. It only loads with the editor (see
// section-editor.tsx). The parent keeps the Markdown: this component reads it
// once when it mounts and sends the new Markdown after every change. To load
// another text, the parent mounts it again with a new key.
//
// Images (KRB-216): files pasted or dropped in the text go to the parent,
// which uploads them as deliverables of the section, then puts each image
// where it was pasted or dropped through `control`, even if the text changed
// during the upload.

/** A place in the text that moves with the edits made after it was taken. */
export type ImagePlace = { pos: number };

export type RichTextControl = {
  /**
   * Puts the image of a deliverable in a paragraph of its own at `place`,
   * or after the selection when the place is from another editor, then
   * moves the cursor after it.
   */
  insertImage: (image: { id: string; caption: string }, place?: ImagePlace | null) => void;
};

export type RichTextEditorProps = {
  /** The Markdown the editor opens on. */
  initialMarkdown: string;
  onChange: (markdown: string) => void;
  /** id of the visible label. */
  labelledBy: string;
  /** id of the help line under the editor. */
  describedBy: string;
  invalid: boolean;
  /** While a save runs: the text can't change, the focus stays. */
  readOnly: boolean;
  /** Move the focus into the text once the editor is ready, then call onAutoFocused. "end": after the last block. */
  autoFocus: boolean | "end";
  onAutoFocused: () => void;
  /** Opens the Markdown tab, for a text this mode can't show. */
  onShowMarkdown: () => void;
  /** Files pasted or dropped in the text, each with the place it goes. */
  onFiles?: (files: { file: File; place: ImagePlace }[]) => void;
  /** Set while the editor is mounted. */
  control?: RefObject<RichTextControl | null>;
};

const fieldClass =
  "rich-text-content min-h-[20rem] w-full rounded-b-lg border border-input bg-card px-3 py-2 text-base leading-relaxed shadow-sm outline-none transition-[border-color,box-shadow] duration-200 focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15 aria-[invalid=true]:border-destructive md:text-sm";

/** The section's text in "Texte" mode, or a notice when it can't be shown that way. */
export function RichTextEditor(props: RichTextEditorProps) {
  const t = useTranslations("SectionEditor");
  // Read once: a new text comes with a new key.
  const [parsed] = useState(() => parseMarkdown(props.initialMarkdown));

  if (!parsed) {
    return (
      <div className="flex min-h-[20rem] flex-col items-start gap-3 rounded-lg border border-dashed px-4 py-3 text-sm">
        <p>{t("visual.tooComplex")}</p>
        <Button type="button" size="sm" variant="outline" onClick={props.onShowMarkdown}>
          {t("visual.showMarkdown")}
        </Button>
      </div>
    );
  }
  return <LoadedEditor {...props} parsed={parsed} />;
}

function LoadedEditor({
  parsed,
  initialMarkdown,
  onChange,
  labelledBy,
  describedBy,
  invalid,
  readOnly,
  autoFocus,
  onAutoFocused,
  onFiles,
  control,
}: RichTextEditorProps & { parsed: ParsedMarkdown }) {
  const t = useTranslations("SectionEditor");
  const toolbarRef = useRef<HTMLDivElement>(null);
  // Places waiting for an image, moved along with every change.
  const places = useRef(new Set<ImagePlace>());
  const onFilesRef = useRef(onFiles);
  // Bound on the first change, to the document the text was read into.
  const origin = useRef<MarkdownOrigin | null | undefined>(undefined);
  const last = useRef(initialMarkdown);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
    onFilesRef.current = onFiles;
  });

  const extensions = useMemo(() => richTextExtensions({ rawTitle: t("visual.raw") }), [t]);
  const attributes = useMemo(
    () => ({
      class: fieldClass,
      "aria-labelledby": labelledBy,
      "aria-describedby": describedBy,
      "aria-invalid": invalid ? "true" : "false",
      "aria-readonly": readOnly ? "true" : "false",
      "aria-multiline": "true",
      spellcheck: "true",
      // No machine translation of the text being written.
      translate: "no",
    }),
    [labelledBy, describedBy, invalid, readOnly],
  );

  const editorProps = useMemo(() => {
    // One place per file: once the first image is in, the next place has moved after it.
    const placeFiles = (files: File[], pos: number) =>
      files.map((file) => {
        const place = { pos };
        places.current.add(place);
        return { file, place };
      });
    return {
      attributes,
      handleKeyDown: (_view: unknown, event: globalThis.KeyboardEvent) => {
        // Alt+F10 goes to the toolbar, as in word processors.
        if (event.altKey && event.key === "F10") {
          event.preventDefault();
          toolbarRef.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
          return true;
        }
        return false;
      },
      handlePaste: (view: EditorView, event: ClipboardEvent) => {
        const files = transferredFiles(event.clipboardData);
        if (!files || !onFilesRef.current) return false;
        onFilesRef.current(placeFiles(files, view.state.selection.to));
        return true;
      },
      handleDrop: (view: EditorView, event: DragEvent, _slice: unknown, moved: boolean) => {
        const files = moved ? null : transferredFiles(event.dataTransfer);
        if (!files || !onFilesRef.current) return false;
        event.preventDefault();
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
        onFilesRef.current(placeFiles(files, at?.pos ?? view.state.selection.to));
        return true;
      },
    };
  }, [attributes]);

  const editor = useEditor({
    extensions,
    content: parsed.doc,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    // Focusable while a save runs, when the text is read-only.
    coreExtensionOptions: { tabindex: { value: "0" } },
    editorProps,
    onTransaction: ({ transaction }) => {
      if (!transaction.docChanged) return;
      for (const place of places.current) place.pos = transaction.mapping.map(place.pos);
    },
    onUpdate: ({ editor: updated, transaction }) => {
      if (origin.current === undefined) origin.current = bindOrigin(parsed, transaction.before);
      const markdown = docToMarkdown(updated.state.doc, origin.current);
      if (markdown === last.current) return;
      last.current = markdown;
      onChangeRef.current(markdown);
    },
  });

  useEffect(() => {
    if (editor && editor.isEditable === readOnly) editor.setEditable(!readOnly, false);
  }, [editor, readOnly]);

  useImperativeHandle<RichTextControl | null, RichTextControl | null>(
    control,
    () =>
      editor && {
        insertImage: ({ id, caption }, place) => {
          const known = place ? places.current.delete(place) : false;
          const pos =
            known && place ? Math.min(place.pos, editor.state.doc.content.size) : editor.state.selection.to;
          const raw = {
            type: "rawInline",
            attrs: {
              mdast: JSON.stringify({ type: "image", url: sectionImagePath(id), title: null, alt: caption }),
              text: sectionImageMarkdown(id, caption),
            },
          };
          editor
            .chain()
            .focus()
            .insertContentAt(pos, { type: "paragraph", content: [raw] }, { updateSelection: true })
            .scrollIntoView()
            .run();
        },
      },
    [editor],
  );

  useEffect(() => {
    if (!editor || !autoFocus) return;
    editor.commands.focus(autoFocus === "end" ? "end" : "start", { scrollIntoView: true });
    onAutoFocused();
  }, [editor, autoFocus, onAutoFocused]);

  return (
    <div>
      {editor ? (
        <Toolbar editor={editor} toolbarRef={toolbarRef} />
      ) : (
        <div className="h-11 rounded-t-lg border border-b-0 bg-muted/40" />
      )}
      <EditorContent editor={editor} />
    </div>
  );
}

type ToolbarState = {
  heading1: boolean;
  heading2: boolean;
  heading3: boolean;
  bold: boolean;
  italic: boolean;
  strike: boolean;
  bulletList: boolean;
  orderedList: boolean;
  blockquote: boolean;
  link: boolean;
  table: boolean;
  canFormat: boolean;
  canTable: boolean;
};

function readState(editor: Editor): ToolbarState {
  return {
    heading1: editor.isActive("heading", { level: 1 }),
    heading2: editor.isActive("heading", { level: 2 }),
    heading3: editor.isActive("heading", { level: 3 }),
    bold: editor.isActive("bold"),
    italic: editor.isActive("italic"),
    strike: editor.isActive("strike"),
    bulletList: editor.isActive("bulletList"),
    orderedList: editor.isActive("orderedList"),
    blockquote: editor.isActive("blockquote"),
    link: editor.isActive("link"),
    table: editor.isActive("table"),
    canFormat: editor.isEditable,
    canTable: editor.isEditable && editor.can().insertTable({ rows: 3, cols: 3, withHeaderRow: true }),
  };
}

type Tool = {
  id: string;
  label: string;
  icon?: LucideIcon;
  /** Shown in the tooltip, for example "Ctrl+B". */
  keys?: string;
  /** aria-keyshortcuts. */
  shortcut?: string;
  pressed?: boolean;
  expanded?: boolean;
  disabled?: boolean;
  run: () => void;
};

/** The formatting buttons. Arrow keys move between them, Escape goes back to the text. */
function Toolbar({ editor, toolbarRef }: { editor: Editor; toolbarRef: RefObject<HTMLDivElement | null> }) {
  const t = useTranslations("SectionEditor.toolbar");
  const id = useId();
  const state = useEditorState({ editor, selector: ({ editor: current }) => readState(current) });
  const [focused, setFocused] = useState(0);
  const [linkOpen, setLinkOpen] = useState(false);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  const chain = () => editor.chain().focus();
  const off = !state.canFormat;

  const tools: Tool[][] = [
    [
      {
        id: "heading1",
        label: t("heading1"),
        icon: Heading1,
        keys: "Ctrl+Alt+1",
        shortcut: "Control+Alt+1",
        pressed: state.heading1,
        run: () => chain().toggleHeading({ level: 1 }).run(),
      },
      {
        id: "heading2",
        label: t("heading2"),
        icon: Heading2,
        keys: "Ctrl+Alt+2",
        shortcut: "Control+Alt+2",
        pressed: state.heading2,
        run: () => chain().toggleHeading({ level: 2 }).run(),
      },
      {
        id: "heading3",
        label: t("heading3"),
        icon: Heading3,
        keys: "Ctrl+Alt+3",
        shortcut: "Control+Alt+3",
        pressed: state.heading3,
        run: () => chain().toggleHeading({ level: 3 }).run(),
      },
    ],
    [
      {
        id: "bold",
        label: t("bold"),
        icon: Bold,
        keys: "Ctrl+B",
        shortcut: "Control+B Meta+B",
        pressed: state.bold,
        run: () => chain().toggleBold().run(),
      },
      {
        id: "italic",
        label: t("italic"),
        icon: Italic,
        keys: "Ctrl+I",
        shortcut: "Control+I Meta+I",
        pressed: state.italic,
        run: () => chain().toggleItalic().run(),
      },
      {
        id: "strike",
        label: t("strike"),
        icon: Strikethrough,
        keys: "Ctrl+Maj+S",
        shortcut: "Control+Shift+S Meta+Shift+S",
        pressed: state.strike,
        run: () => chain().toggleStrike().run(),
      },
    ],
    [
      {
        id: "bulletList",
        label: t("bulletList"),
        icon: List,
        keys: "Ctrl+Maj+8",
        shortcut: "Control+Shift+8",
        pressed: state.bulletList,
        run: () => chain().toggleBulletList().run(),
      },
      {
        id: "orderedList",
        label: t("orderedList"),
        icon: ListOrdered,
        keys: "Ctrl+Maj+7",
        shortcut: "Control+Shift+7",
        pressed: state.orderedList,
        run: () => chain().toggleOrderedList().run(),
      },
      {
        id: "blockquote",
        label: t("blockquote"),
        icon: TextQuote,
        keys: "Ctrl+Maj+B",
        shortcut: "Control+Shift+B",
        pressed: state.blockquote,
        run: () => chain().toggleBlockquote().run(),
      },
    ],
    [
      {
        id: "link",
        label: t("link"),
        icon: LinkIcon,
        expanded: linkOpen,
        run: () => setLinkOpen((open) => !open),
      },
      {
        id: "table",
        label: t("table"),
        icon: TableIcon,
        disabled: !state.canTable,
        run: () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
      },
    ],
  ];
  if (state.table) {
    tools.push([
      { id: "addRow", label: t("addRow"), run: () => chain().addRowAfter().run() },
      { id: "addColumn", label: t("addColumn"), run: () => chain().addColumnAfter().run() },
      { id: "deleteRow", label: t("deleteRow"), run: () => chain().deleteRow().run() },
      { id: "deleteColumn", label: t("deleteColumn"), run: () => chain().deleteColumn().run() },
      { id: "deleteTable", label: t("deleteTable"), run: () => chain().deleteTable().run() },
    ]);
  }
  const flat = tools.flat();
  const current = Math.min(focused, flat.length - 1);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      editor.commands.focus();
      return;
    }
    const next =
      event.key === "ArrowRight"
        ? (current + 1) % flat.length
        : event.key === "ArrowLeft"
          ? (current - 1 + flat.length) % flat.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? flat.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    setFocused(next);
    buttons.current[next]?.focus();
  }

  let index = -1;
  const linkFormId = `${id}-link`;

  return (
    <div className="rounded-t-lg border border-b-0 bg-muted/40">
      <div
        ref={toolbarRef}
        role="toolbar"
        aria-label={t("label")}
        onKeyDown={onKeyDown}
        className="flex flex-wrap items-center gap-x-1 gap-y-1 px-1.5 py-1.5"
      >
        {tools.map((group, groupIndex) => (
          <ToolGroup
            key={group[0]!.id}
            separator={groupIndex > 0}
            table={group[0]!.id === "addRow"}
            tableLabel={t("tableGroup")}
          >
            {group.map((tool) => {
              index++;
              const position = index;
              const disabled = off || tool.disabled;
              const Icon = tool.icon;
              const tooltip = tool.keys ? t("withKeys", { label: tool.label, keys: tool.keys }) : tool.label;
              return (
                <Button
                  key={tool.id}
                  ref={(element) => {
                    buttons.current[position] = element;
                  }}
                  type="button"
                  variant="ghost"
                  size={Icon ? "icon" : "sm"}
                  tabIndex={position === current ? 0 : -1}
                  aria-label={Icon ? tool.label : undefined}
                  title={tooltip}
                  aria-pressed={tool.pressed === undefined ? undefined : tool.pressed}
                  aria-expanded={tool.expanded}
                  aria-controls={tool.expanded ? linkFormId : undefined}
                  aria-keyshortcuts={tool.shortcut}
                  aria-disabled={disabled || undefined}
                  className={cn(
                    "shrink-0 rounded-md aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-sm aria-pressed:ring-1 aria-pressed:ring-border",
                    // Bigger touch targets on phones.
                    Icon ? "size-10 sm:size-9" : "h-10 px-2.5 sm:h-9",
                  )}
                  // Keeps the selection in the text on a click.
                  onMouseDown={(event) => event.preventDefault()}
                  onFocus={() => setFocused(position)}
                  onClick={() => {
                    if (!disabled) tool.run();
                  }}
                >
                  {Icon ? <Icon aria-hidden="true" /> : tool.label}
                </Button>
              );
            })}
          </ToolGroup>
        ))}
      </div>
      {linkOpen ? (
        <LinkForm
          id={linkFormId}
          editor={editor}
          onClose={() => {
            setLinkOpen(false);
            editor.commands.focus();
          }}
        />
      ) : null}
    </div>
  );
}

function ToolGroup({
  separator,
  table,
  tableLabel,
  children,
}: {
  separator: boolean;
  table: boolean;
  tableLabel: string;
  children: ReactNode;
}) {
  return (
    <>
      {separator ? <span aria-hidden="true" className="mx-0.5 h-6 w-px bg-border" /> : null}
      {table ? <span className="px-1 text-xs font-medium text-muted-foreground">{tableLabel}</span> : null}
      {children}
    </>
  );
}

/** Adds "https://" to an address typed without it, and "mailto:" to an e-mail address. */
export function normalizeHref(value: string): string {
  const href = value.trim();
  if (!href) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return href;
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(href)) return `mailto:${href}`;
  return `https://${href.replace(/^\/+/, "")}`;
}

function LinkForm({ id, editor, onClose }: { id: string; editor: Editor; onClose: () => void }) {
  const t = useTranslations("SectionEditor.toolbar");
  const inputId = useId();
  const errorId = useId();
  const active = editor.isActive("link");
  const [value, setValue] = useState(() => String(editor.getAttributes("link").href ?? ""));
  const [invalid, setInvalid] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function apply(event: FormEvent) {
    event.preventDefault();
    const href = normalizeHref(value);
    if (!isSafeHref(href) || /\s/.test(href)) {
      setInvalid(true);
      inputRef.current?.focus();
      return;
    }
    const { empty } = editor.state.selection;
    if (empty && !active) {
      // No text selected: the address becomes the link's text.
      editor
        .chain()
        .focus()
        .insertContent({ type: "text", text: value.trim(), marks: [{ type: "link", attrs: { href } }] })
        .run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    }
    onClose();
  }

  return (
    <form
      id={id}
      noValidate
      onSubmit={apply}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
      className="flex flex-wrap items-end gap-2 border-t px-3 py-2"
    >
      <div className="min-w-0 flex-1 basis-56 space-y-1">
        <label htmlFor={inputId} className="text-xs font-medium">
          {t("linkAddress")}
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="url"
          inputMode="url"
          autoComplete="url"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setInvalid(false);
          }}
          placeholder="https://"
          aria-invalid={invalid}
          aria-describedby={invalid ? errorId : undefined}
          className="flex h-10 w-full rounded-lg border border-input bg-card px-3 text-base shadow-sm outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15 aria-[invalid=true]:border-destructive sm:h-9 md:text-sm"
        />
        {invalid ? (
          <p id={errorId} role="alert" className="text-xs text-destructive">
            {t("linkInvalid")}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm">
          {t("linkApply")}
        </Button>
        {active ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              editor.chain().focus().extendMarkRange("link").unsetLink().run();
              onClose();
            }}
          >
            {t("linkRemove")}
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          {t("linkClose")}
        </Button>
      </div>
    </form>
  );
}
