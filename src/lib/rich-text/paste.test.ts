import { Editor, getSchema } from "@tiptap/core";
import { DOMParser as PmDOMParser } from "@tiptap/pm/model";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { bindOrigin, docToMarkdown, parseMarkdown } from "./markdown";
import { cleanPastedHtml } from "./paste";
import { richTextExtensions } from "./schema";

const schema = getSchema(richTextExtensions());

beforeAll(() => {
  // jsdom draws nothing: ProseMirror measures the selection to scroll to it.
  const rects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
  Range.prototype.getClientRects ??= rects;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
  Element.prototype.getClientRects ??= rects;
  document.elementFromPoint ??= () => null;
});

/** What the editor keeps of a paste, as the Markdown it saves. */
function pasted(html: string): string {
  const body = new DOMParser().parseFromString(cleanPastedHtml(html), "text/html").body;
  return docToMarkdown(PmDOMParser.fromSchema(schema).parse(body));
}

// Copied from Word for Windows: lists are paragraphs with a bullet drawn in a span.
const WORD = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:v="urn:schemas-microsoft-com:vml">
<head><meta charset="utf-8"><style>p.MsoNormal{margin:0cm;font-family:"Calibri"}</style></head>
<body lang=FR>
<!--StartFragment-->
<h1>Bilan énergétique<o:p></o:p></h1>
<p class=MsoNormal><b><span style='color:#C00000'>Consommation</span></b> du site en <i>2025</i>,
<span style='font-family:"Comic Sans MS";text-decoration:underline'>souligné</span>.<o:p></o:p></p>
<p class=MsoListParagraphCxSpFirst style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]><span
style='font-family:Symbol'><span style='mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;
</span></span></span><![endif]>Chaufferie<o:p></o:p></p>
<p class=MsoListParagraphCxSpMiddle style='margin-left:72.0pt;text-indent:-18.0pt;mso-list:l0 level2 lfo1'><![if !supportLists]><span
style='font-family:"Courier New"'><span style='mso-list:Ignore'>o<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;
</span></span></span><![endif]>Brûleur de <b>1998</b><o:p></o:p></p>
<p class=MsoListParagraphCxSpLast style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]><span
style='font-family:Symbol'><span style='mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;
</span></span></span><![endif]>Éclairage<o:p></o:p></p>
<p class=MsoListParagraphCxSpFirst style='text-indent:-18.0pt;mso-list:l1 level1 lfo2'><![if !supportLists]><span><span
style='mso-list:Ignore'>1.<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp; </span></span></span><![endif]>Isoler<o:p></o:p></p>
<p class=MsoListParagraphCxSpLast style='text-indent:-18.0pt;mso-list:l1 level1 lfo2'><![if !supportLists]><span><span
style='mso-list:Ignore'>2.<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp; </span></span></span><![endif]>Remplacer<o:p></o:p></p>
<table class=MsoTableGrid border=1 cellspacing=0 cellpadding=0 style='border-collapse:collapse'>
 <tr><td width=302 valign=top style='width:226.6pt;border:solid windowtext 1.0pt'><p class=MsoNormal><b>Poste</b><o:p></o:p></p></td>
  <td><p class=MsoNormal><b>Part</b></p></td></tr>
 <tr><td><p class=MsoNormal>Climatisation</p><p class=MsoNormal>et ventilation</p></td>
  <td><p class=MsoNormal align=right style='text-align:right'>58 %</p></td></tr>
 <tr><td colspan=2><p class=MsoNormal>Total sur deux colonnes</p></td></tr>
</table>
<p class=MsoNormal><o:p>&nbsp;</o:p></p>
<p class=MsoNormal><v:shape id="Image_1"><v:imagedata src="file:///C:/image.png"/></v:shape><img width=100
src="https://tracker.example/pixel.png"></p>
<!--EndFragment-->
</body></html>`;

const WEB = `<meta charset="utf-8"><style>.x{color:red}</style><script>alert(1)</script>
<h2 class="title" onclick="steal()">Titre web</h2>
<p>Texte <strong>gras</strong>, <em>italique</em>, <u>souligné</u>,
<span style="color:red;font-weight:bold;background:url(https://evil.example/x.png)">rouge gras</span>,
<a href="javascript:alert(1)">piège</a>, <font face="Arial" color="red">police</font>,
<a href="https://example.com/doc" class="fixed inset-0" target="_self" onmouseover="x()">lien</a>.</p>
<img src="https://evil.example/pixel.png" onerror="alert(1)">
<iframe src="https://evil.example/frame"></iframe>
<ul><li>Un</li><li>Deux<ul><li>Deux point un</li></ul></li></ul>
<blockquote><p>Citation</p></blockquote>
<form><input value="champ"><button>Envoyer</button></form>
<svg><a href="https://evil.example/svg"><text>svg</text></a></svg>`;

describe("cleanPastedHtml", () => {
  it("keeps headings, bold, lists and tables from Word, and drops the rest", () => {
    expect(pasted(WORD)).toBe(
      [
        "# Bilan énergétique",
        "**Consommation** du site en *2025*, souligné.",
        "- Chaufferie\n  - Brûleur de **1998**\n- Éclairage",
        "1. Isoler\n2. Remplacer",
        "| **Poste** | **Part** |\n| - | -: |\n| Climatisation et ventilation | 58 % |\n| Total sur deux colonnes | |",
      ].join("\n\n"),
    );
  });

  it("removes scripts, styles, images, frames and unsafe links from a web page", () => {
    const html = cleanPastedHtml(WEB);
    for (const removed of [
      "<script",
      "<style",
      "<img",
      "<iframe",
      "<svg",
      "<input",
      "<button",
      "onerror",
      "onclick",
      "onmouseover",
      "javascript:",
      "evil.example",
      "class=",
      "target=",
      "color",
    ]) {
      expect(html).not.toContain(removed);
    }
    expect(pasted(WEB)).toBe(
      [
        "## Titre web",
        "Texte **gras**, *italique*, souligné, **rouge gras**, piège, police, [lien](https://example.com/doc).",
        "- Un\n- Deux\n  - Deux point un",
        "> Citation",
      ].join("\n\n"),
    );
  });

  it("reads Google Docs bold without making the whole paste bold", () => {
    const html =
      '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><p dir="ltr"><span style="font-weight:700;">Gras</span><span style="font-weight:400;font-style:italic;"> puis italique</span></p></b>';
    expect(pasted(html)).toBe("**Gras** *puis italique*");
  });

  it("keeps the context of the editor's own copies, unless it names raw Markdown", () => {
    const safe = cleanPastedHtml('<ul data-pm-slice="3 3 []"><li><p>Point</p></li></ul>');
    expect(safe).toContain('data-pm-slice="3 3 []"');
    const raw = cleanPastedHtml(
      '<p data-pm-slice="1 1 [&quot;rawBlock&quot;,{&quot;mdast&quot;:&quot;{}&quot;}]">Texte</p>',
    );
    expect(raw).not.toContain("data-pm-slice");
  });

  it("turns merged and nested table cells into a plain grid with a header row", () => {
    const html = `<table><thead><tr><td rowspan="2">A</td><td>B</td></tr></thead>
      <tbody><tr><td><table><tr><td>x</td><td>y</td></tr></table></td></tr>
      <tr><td><ul><li>un</li><li>deux</li></ul></td><td>fin<br>de ligne</td></tr></tbody></table>`;
    expect(pasted(html)).toBe("| A | B |\n| - | - |\n| | x y |\n| un deux | fin de ligne |");
  });
});

const editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

/** A Texte editor on `markdown`, and the Markdown it saves, as in rich-text-editor.tsx. */
function openEditor(markdown: string) {
  const parsed = parseMarkdown(markdown);
  if (!parsed) throw new Error("not parsed");
  const editor = new Editor({
    element: document.body.appendChild(document.createElement("div")),
    extensions: richTextExtensions(),
    content: parsed.doc,
  });
  editors.push(editor);
  const origin = bindOrigin(parsed, editor.state.doc);
  return { editor, saved: () => docToMarkdown(editor.state.doc, origin) };
}

type Clipboard = Record<string, string>;

/** A copy, cut or paste event on the editor, with the clipboard the browser would give. */
function clipboardEvent(editor: Editor, type: "copy" | "cut" | "paste", data: Clipboard) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      clearData: () => {
        for (const format of Object.keys(data)) delete data[format];
      },
      setData: (format: string, value: string) => {
        data[format] = value;
      },
      getData: (format: string) => data[format] ?? "",
    },
  });
  editor.view.dom.dispatchEvent(event);
}

// What the editor's HTML can't carry: raw Markdown and a link the page doesn't open.
const OWN =
  "Voir la note[^1] et l'[annexe](annexe.pdf) et [ref][r] et ![logo](a.png) et a<br>b.\n\n[^1]: Une note.\n\n[r]: https://example.com";
const FIRST = "Voir la note[^1] et l'[annexe](annexe.pdf) et [ref][r] et ![logo](a.png) et a<br>b.";
// The same paragraph read from its HTML, cleaned.
const CLEANED = "Voir la note`[^1]` et l'annexe et `[ref][r]` et `![logo](a.png)` et a`<br>`b.";

/** Copies the first paragraph's text. */
function copyFirst(editor: Editor): Clipboard {
  editor.commands.setTextSelection({ from: 1, to: editor.state.doc.child(0).nodeSize - 1 });
  const data: Clipboard = {};
  clipboardEvent(editor, "copy", data);
  return data;
}

describe("copy and paste inside the editor", () => {
  it("pastes its own copy as it was, raw Markdown and links included", () => {
    const { editor, saved } = openEditor(OWN);
    const data = copyFirst(editor);
    expect(data["text/html"]).toContain("data-pm-slice");

    // Over the copied text: the Markdown doesn't change.
    clipboardEvent(editor, "paste", data);
    expect(saved()).toBe(OWN);

    // At the end of the paragraph.
    editor.commands.setTextSelection(editor.state.doc.child(0).nodeSize - 1);
    clipboardEvent(editor, "paste", data);
    expect(saved()).toBe(OWN.replace(FIRST, FIRST + FIRST));
  });

  it("pastes back what was cut, with the line endings of a Windows clipboard", () => {
    const { editor, saved } = openEditor(OWN);
    editor.commands.selectAll();
    const data: Clipboard = {};
    clipboardEvent(editor, "cut", data);
    expect(saved()).toBe("");
    expect(data["text/plain"]).toContain("\n\n");
    clipboardEvent(editor, "paste", { ...data, "text/plain": data["text/plain"]!.replace(/\n/g, "\r\n") });
    expect(saved()).toBe(OWN);
  });

  it("cleans the same HTML when it is not this editor's last copy", () => {
    const { editor, saved } = openEditor(OWN);
    const data = copyFirst(editor);

    // Another editor never copied it.
    const other = openEditor("");
    clipboardEvent(other.editor, "paste", data);
    expect(other.saved()).toBe(CLEANED);

    // Same HTML, other text: a forged clipboard.
    editor.commands.setTextSelection(editor.state.doc.child(0).nodeSize - 1);
    clipboardEvent(editor, "paste", { ...data, "text/plain": "Autre texte" });
    expect(saved()).toBe(OWN.replace(FIRST, FIRST + CLEANED));
  });
});
