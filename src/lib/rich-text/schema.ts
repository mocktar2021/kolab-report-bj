import { Extension, mergeAttributes, Node, type Extensions } from "@tiptap/core";
import { Code } from "@tiptap/extension-code";
import { Heading } from "@tiptap/extension-heading";
import { Link } from "@tiptap/extension-link";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { StarterKit } from "@tiptap/starter-kit";
import { cleanPastedHtml } from "./paste";

// The document model of the "Texte" mode of the section editor (KRB-197). It
// holds only what the section's Markdown can hold and what the app renders:
// headings, bold, italic, strikethrough, inline code, links, lists, quotes,
// code blocks, rules and GitHub tables. No underline, colors, fonts or
// images. Pasted HTML that doesn't fit this model is dropped by the parser.
// Markdown the model doesn't know (images, raw HTML, footnotes, reference
// links) is kept as a locked "raw" node and written back unchanged.

/** Web pages and e-mail addresses only. Anything else is never a clickable link. */
export function isSafeHref(href: string | null | undefined): boolean {
  return typeof href === "string" && /^(?:https?:\/\/|mailto:)/i.test(href.trim());
}

/**
 * Typed text turned into a link, like GitHub Markdown does: addresses with
 * a protocol or starting with www., and e-mail addresses. "rapport.fr" stays
 * text.
 */
function autoLinks(url: string): boolean {
  return /^(?:https?:\/\/|www\.)/i.test(url) || /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(url);
}

/** The heading tag in the editor: the page has its h1 and the h2 of the content card. */
export function headingTag(level: number): string {
  return `h${Math.min(Math.max(level, 1) + 2, 6)}`;
}

const SectionHeading = Heading.extend({
  parseHTML() {
    // data-level comes from a copy inside the editor, where # is drawn as h3.
    return this.options.levels.map((level) => ({
      tag: `h${level}`,
      getAttrs: (element: HTMLElement) => {
        const copied = Number(element.getAttribute("data-level"));
        return { level: Number.isInteger(copied) && copied >= 1 && copied <= 6 ? copied : level };
      },
    }));
  },
  renderHTML({ node, HTMLAttributes }) {
    const level = Number(node.attrs.level) || 1;
    return [
      headingTag(level),
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { "data-level": level }),
      0,
    ];
  },
});

const SafeLink = Link.extend({
  // Text typed right after a link is not part of it, as in Word.
  inclusive() {
    return false;
  },
  // Only the address and the title: a pasted class or target is dropped.
  addAttributes() {
    return {
      href: { default: null, parseHTML: (element) => element.getAttribute("href") },
      title: { default: null, parseHTML: (element) => element.getAttribute("title") },
    };
  },
});

// Markdown writes **`code`** and [`code`](url): inline code can carry other marks.
const MarkdownCode = Code.extend({ excludes: "" });

// GitHub table cells hold one line of text, without lists or paragraphs.
const MarkdownTableCell = TableCell.extend({ content: "paragraph" });
const MarkdownTableHeader = TableHeader.extend({ content: "paragraph" });

const ALIGNS = new Set(["left", "center", "right"]);

function alignOf(element: HTMLElement): string | null {
  const value = (element.style.textAlign || element.getAttribute("align") || "").toLowerCase();
  return ALIGNS.has(value) ? value : null;
}

/** Markdown details the editor keeps but doesn't show: list spacing, task boxes, column alignment. */
const MarkdownAttributes = Extension.create({
  name: "markdownAttributes",
  addGlobalAttributes() {
    return [
      {
        types: ["bulletList", "orderedList", "listItem"],
        attributes: { spread: { default: false, rendered: false, parseHTML: () => false } },
      },
      {
        types: ["listItem"],
        attributes: {
          checked: {
            default: null,
            parseHTML: () => null,
            renderHTML: (attributes) =>
              typeof attributes.checked === "boolean" ? { "data-checked": String(attributes.checked) } : {},
          },
        },
      },
      {
        types: ["tableCell", "tableHeader"],
        attributes: {
          align: {
            default: null,
            parseHTML: alignOf,
            renderHTML: (attributes) =>
              ALIGNS.has(attributes.align as string) ? { style: `text-align: ${attributes.align}` } : {},
          },
        },
      },
      {
        types: ["codeBlock"],
        attributes: { meta: { default: null, rendered: false, parseHTML: () => null } },
      },
    ];
  },
});

type RawOptions = { title: string };

/**
 * Markdown the editor can't show as formatted text, kept as is. `mdast` is
 * the node as JSON, written back in place; `text` is its source, shown in the
 * editor. Paste never creates one: they come from the section's own text.
 */
const RawBlock = Node.create<RawOptions>({
  name: "rawBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,
  addOptions() {
    return { title: "" };
  },
  addAttributes() {
    return {
      mdast: { default: null, rendered: false },
      text: { default: "", rendered: false },
    };
  },
  parseHTML() {
    return [];
  },
  renderHTML({ node }) {
    return [
      "pre",
      { class: "rich-text-raw", "data-raw": "block", title: this.options.title || null },
      String(node.attrs.text ?? ""),
    ];
  },
  renderText({ node }) {
    return String(node.attrs.text ?? "");
  },
});

const RawInline = Node.create<RawOptions>({
  name: "rawInline",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  addOptions() {
    return { title: "" };
  },
  addAttributes() {
    return {
      mdast: { default: null, rendered: false },
      text: { default: "", rendered: false },
    };
  },
  parseHTML() {
    return [];
  },
  renderHTML({ node }) {
    return [
      "code",
      { class: "rich-text-raw", "data-raw": "inline", title: this.options.title || null },
      String(node.attrs.text ?? ""),
    ];
  },
  renderText({ node }) {
    return String(node.attrs.text ?? "");
  },
});

/** Cleans pasted HTML before ProseMirror reads it (see paste.ts). */
const PasteCleanup = Extension.create({
  name: "pasteCleanup",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("pasteCleanup"),
        props: { transformPastedHTML: (html) => cleanPastedHtml(html) },
      }),
    ];
  },
});

export type RichTextOptions = {
  /** Tooltip of the raw Markdown nodes. */
  rawTitle?: string;
};

/** The editor's extensions. The tests build the same schema from them. */
export function richTextExtensions({ rawTitle = "" }: RichTextOptions = {}): Extensions {
  return [
    StarterKit.configure({
      code: false,
      heading: false,
      link: false,
      underline: false,
      trailingNode: false,
      dropcursor: { color: "hsl(var(--ring))", width: 2 },
    }),
    MarkdownCode,
    SectionHeading.configure({ levels: [1, 2, 3, 4, 5, 6] }),
    SafeLink.configure({
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      defaultProtocol: "http",
      isAllowedUri: (url) => isSafeHref(url),
      shouldAutoLink: autoLinks,
      HTMLAttributes: { target: "_blank", rel: "noopener noreferrer nofollow", class: null },
    }),
    Table.configure({ resizable: false, renderWrapper: true, allowTableNodeSelection: false }),
    TableRow,
    MarkdownTableHeader,
    MarkdownTableCell,
    MarkdownAttributes,
    RawBlock.configure({ title: rawTitle }),
    RawInline.configure({ title: rawTitle }),
    PasteCleanup,
  ];
}
