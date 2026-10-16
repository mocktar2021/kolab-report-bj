// Cleans HTML pasted into the "Texte" mode of the section editor (KRB-197),
// before ProseMirror reads it. ProseMirror then keeps only what the editor's
// schema knows (see schema.ts), so this step removes what must never get in
// and reshapes what the parser would read badly:
// - scripts, styles, images, media, frames and form fields are removed, with
//   every attribute but a safe href, the formatting part of style (bold,
//   italic, strikethrough, alignment) and a code block's language;
// - Word lists, drawn as paragraphs with a bullet character, become real
//   lists;
// - tables lose merged cells and get one line of text per cell, the way a
//   GitHub table holds them, with the first row as header.
// It runs on a document built by DOMParser: nothing in it loads or runs.

const REMOVED_TAGS = new Set([
  "applet",
  "audio",
  "base",
  "button",
  "canvas",
  "datalist",
  "dialog",
  "embed",
  "frame",
  "frameset",
  "head",
  "iframe",
  "img",
  "input",
  "link",
  "map",
  "math",
  "meta",
  "noscript",
  "object",
  "option",
  "picture",
  "portal",
  "script",
  "select",
  "source",
  "style",
  "svg",
  "template",
  "textarea",
  "title",
  "track",
  "video",
]);

/** Blocks inside a table cell, flattened to text separated by spaces. */
const CELL_BLOCKS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "dd",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);

/** Style properties the editor reads as formatting. Every other one goes. */
const KEPT_STYLES = new Set([
  "font-weight",
  "font-style",
  "text-decoration",
  "text-decoration-line",
  "text-align",
]);

/** Node types allowed in the context ProseMirror writes on its own copies (data-pm-slice). */
const SLICE_CONTEXT_TYPES = new Set([
  "blockquote",
  "bulletList",
  "codeBlock",
  "heading",
  "listItem",
  "orderedList",
  "paragraph",
  "table",
  "tableCell",
  "tableHeader",
  "tableRow",
]);

function safeHref(href: string | null): boolean {
  return href !== null && /^(?:https?:\/\/|mailto:)/i.test(href.trim());
}

function keptStyle(style: string): string {
  return style
    .split(";")
    .map((declaration) => declaration.trim())
    .filter((declaration) => {
      const name = declaration.split(":")[0]?.trim().toLowerCase() ?? "";
      return KEPT_STYLES.has(name) && !/url\s*\(|expression\s*\(/i.test(declaration);
    })
    .join("; ");
}

/** True when the copy context only names wrappers the editor has. */
function safeSliceContext(value: string): boolean {
  const match = /^\d+ \d+(?: -\d+)? (.*)$/.exec(value);
  if (!match) return false;
  try {
    const context: unknown = JSON.parse(match[1] ?? "");
    if (!Array.isArray(context)) return false;
    return context.every((item, index) =>
      index % 2 === 0
        ? typeof item === "string" && SLICE_CONTEXT_TYPES.has(item)
        : item === null || typeof item === "object",
    );
  } catch {
    return false;
  }
}

function unwrap(element: Element) {
  element.replaceWith(...Array.from(element.childNodes));
}

function cleanAttributes(element: Element) {
  const tag = element.localName;
  for (const { name, value } of Array.from(element.attributes)) {
    const keep =
      (name === "href" && tag === "a" && safeHref(value)) ||
      (name === "title" && tag === "a") ||
      (name === "start" && tag === "ol" && /^\d{1,9}$/.test(value)) ||
      (name === "class" && tag === "code" && /^language-[\w+#-]{1,40}$/.test(value)) ||
      (name === "data-level" && /^h[1-6]$/.test(tag)) ||
      (name === "data-pm-slice" && safeSliceContext(value));
    if (name === "style") {
      const style = keptStyle(value);
      if (style) element.setAttribute("style", style);
      else element.removeAttribute("style");
    } else if (!keep) {
      element.removeAttribute(name);
    }
  }
}

// Word lists: <p style="mso-list:l0 level2 lfo1"><span style="mso-list:Ignore">1.</span>Text</p>.

const WORD_LIST = /mso-list:\s*l(\d+)\s+level(\d+)/i;
const WORD_MARKER = /mso-list:\s*ignore/i;
/** 1. 1) a. (a) iv. and the like. Bullets (·, o, §, -) are anything else. */
const ORDERED_MARKER = /^\(?(?:\d{1,4}|[a-z]|[ivxlcdm]{1,6})[.)]$/i;

type WordItem = { element: Element; list: string; level: number; ordered: boolean };

function wordItem(element: Element): WordItem | null {
  const match = WORD_LIST.exec(element.getAttribute("style") ?? "");
  if (!match) return null;
  const marker = Array.from(element.querySelectorAll("[style]")).find((child) =>
    WORD_MARKER.test(child.getAttribute("style") ?? ""),
  );
  const text = (marker?.textContent ?? "").replace(/[\s ]+/g, "");
  marker?.remove();
  return {
    element,
    list: match[1] ?? "",
    level: Math.min(Number(match[2]) || 1, 9),
    ordered: ORDERED_MARKER.test(text),
  };
}

function nextElement(node: Element): Element | null {
  let next = node.nextSibling;
  while (next && next.nodeType === 3 && !(next.textContent ?? "").trim()) next = next.nextSibling;
  return next && next.nodeType === 1 ? (next as Element) : null;
}

function convertWordLists(doc: Document) {
  const done = new Set<Element>();
  for (const start of Array.from(doc.body.querySelectorAll("[style*='mso-list']"))) {
    if (done.has(start)) continue;
    const first = wordItem(start);
    if (!first) continue;
    const run: WordItem[] = [first];
    done.add(start);
    for (let next = nextElement(start); next; next = nextElement(next)) {
      // Another Word list right after this one starts a new list.
      if (WORD_LIST.exec(next.getAttribute("style") ?? "")?.[1] !== first.list) break;
      const item = wordItem(next);
      if (!item) break;
      run.push(item);
      done.add(next);
    }

    const stack: Array<{ level: number; list: Element }> = [];
    for (const item of run) {
      while (stack.length > 0 && stack[stack.length - 1]!.level > item.level) stack.pop();
      let current = stack[stack.length - 1];
      if (!current || current.level < item.level) {
        const list = doc.createElement(item.ordered ? "ol" : "ul");
        if (current) {
          let parent = current.list.lastElementChild;
          if (!parent) parent = current.list.appendChild(doc.createElement("li"));
          parent.appendChild(list);
        } else {
          first.element.before(list);
        }
        current = { level: item.level, list };
        stack.push(current);
      }
      const li = doc.createElement("li");
      li.append(...Array.from(item.element.childNodes));
      current.list.appendChild(li);
      item.element.remove();
    }
  }
}

// Tables: a grid without merged cells, header first, one line per cell.

function flattenCell(doc: Document, cell: Element): DocumentFragment {
  const fragment = doc.createDocumentFragment();
  fragment.append(...Array.from(cell.childNodes));
  for (const br of Array.from(fragment.querySelectorAll("br"))) br.replaceWith(doc.createTextNode(" "));
  // Deepest first, so each block's text is already flat when it is unwrapped.
  const blocks = Array.from(fragment.querySelectorAll("*"))
    .filter((element) => CELL_BLOCKS.has(element.localName))
    .reverse();
  for (const block of blocks) {
    block.after(doc.createTextNode(" "));
    block.before(doc.createTextNode(" "));
    unwrap(block);
  }
  return fragment;
}

/** The cell's alignment, or the one Word puts on the paragraph inside it. */
function alignOf(cell: Element): string | null {
  for (const element of [cell, cell.querySelector("[align], [style*='text-align']")]) {
    if (!element) continue;
    const style = /text-align:\s*(left|center|right)\b/i.exec(element.getAttribute("style") ?? "")?.[1];
    const value = (style ?? element.getAttribute("align") ?? "").toLowerCase();
    if (value === "left" || value === "center" || value === "right") return value;
  }
  return null;
}

function span(cell: Element, name: "colspan" | "rowspan"): number {
  const value = Number(cell.getAttribute(name) ?? 1);
  return Number.isInteger(value) && value > 1 ? Math.min(value, 50) : 1;
}

function rebuildTable(doc: Document, table: Element) {
  const rows = Array.from(table.querySelectorAll("tr")).filter((row) => row.closest("table") === table);
  const grid: Array<Array<Element | null>> = [];
  rows.forEach((row, rowIndex) => {
    grid[rowIndex] ??= [];
    let column = 0;
    for (const cell of Array.from(row.children).filter((child) => /^t[dh]$/.test(child.localName))) {
      while (grid[rowIndex]![column] !== undefined) column++;
      const width = span(cell, "colspan");
      const height = Math.min(span(cell, "rowspan"), rows.length - rowIndex);
      for (let down = 0; down < height; down++) {
        grid[rowIndex + down] ??= [];
        for (let across = 0; across < width; across++) {
          grid[rowIndex + down]![column + across] = down === 0 && across === 0 ? cell : null;
        }
      }
      column += width;
    }
  });
  const columns = Math.max(0, ...grid.map((row) => row.length));
  const rebuilt = doc.createElement("table");
  const body = rebuilt.appendChild(doc.createElement("tbody"));
  grid.forEach((cells, rowIndex) => {
    const row = body.appendChild(doc.createElement("tr"));
    for (let column = 0; column < columns; column++) {
      const source = cells[column] ?? null;
      const cell = row.appendChild(doc.createElement(rowIndex === 0 ? "th" : "td"));
      if (source) {
        const align = alignOf(source);
        if (align) cell.setAttribute("style", `text-align: ${align}`);
        cell.append(flattenCell(doc, source));
      }
    }
  });
  if (columns === 0) table.remove();
  else table.replaceWith(rebuilt);
}

/** Pasted HTML, reduced to what the section's Markdown can hold. */
export function cleanPastedHtml(html: string): string {
  if (typeof DOMParser === "undefined") return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  const body = doc.body;

  // Comments, among them Word's conditional ones around list bullets.
  const walker = doc.createTreeWalker(body, 128 /* NodeFilter.SHOW_COMMENT */);
  const comments: Node[] = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  for (const comment of comments) comment.parentNode?.removeChild(comment);

  for (const element of Array.from(body.querySelectorAll("*"))) {
    // Namespaced Office tags such as <o:p> or <v:shape>.
    if (REMOVED_TAGS.has(element.localName) || element.localName.includes(":")) element.remove();
  }

  convertWordLists(doc);

  // Innermost first: a table in a cell becomes text before its parent is rebuilt.
  for (const table of Array.from(body.querySelectorAll("table")).reverse()) {
    if (table.isConnected) rebuildTable(doc, table);
  }

  for (const element of Array.from(body.querySelectorAll("*"))) {
    if (element.localName === "a" && !safeHref(element.getAttribute("href"))) {
      cleanAttributes(element);
      unwrap(element);
      continue;
    }
    cleanAttributes(element);
  }
  return body.innerHTML;
}
