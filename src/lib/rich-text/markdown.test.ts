import { getSchema, type JSONContent } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";
import { bindOrigin, docToMarkdown, parseMarkdown } from "./markdown";
import { richTextExtensions } from "./schema";

const schema = getSchema(richTextExtensions());

function load(markdown: string) {
  const parsed = parseMarkdown(markdown);
  if (!parsed) throw new Error("not parsed");
  const doc = schema.nodeFromJSON(parsed.doc);
  doc.check();
  return { parsed, doc, origin: bindOrigin(parsed, doc) };
}

function fromJson(content: JSONContent[]): PmNode {
  const doc = schema.nodeFromJSON({ type: "doc", content });
  doc.check();
  return doc;
}

/** Written without the stored text: every block goes through the Markdown writer. */
function rewrite(markdown: string): string {
  return docToMarkdown(load(markdown).doc);
}

/** The document with its top level block at `index` replaced. The other blocks stay the same objects. */
function replaceBlock(doc: PmNode, index: number, json: JSONContent): PmNode {
  return doc.copy(doc.content.replaceChild(index, schema.nodeFromJSON(json)));
}

const paragraph = (text: string): JSONContent => ({ type: "paragraph", content: [{ type: "text", text }] });

// The shape of an accepted AI draft (src/lib/ai/schemas.ts draftToMarkdown).
const AI_DRAFT = `**Résumé.** La consommation du site a baissé de 12 % entre 2024 et 2025.

### Points clés

- La chaufferie consomme 38 % de l'énergie.
- Les relevés de février montrent deux pics.

Le bâtiment administratif consomme 412 MWh par an. Voir le [guide de l'ADEME](https://www.ademe.fr/guide).

| Mois | MWh | Écart |
| --- | ---: | :---: |
| Janvier | 31 | -2 % |
| Février | 36 | +4 % |

### Recommandations

1. Remplacer les groupes froids en 2027.
2. Isoler la toiture du bâtiment B.
   - Devis demandé le 3 mars.
   - Aide possible : *CEE*.

> Les données de mars sont provisoires.

### Sources

- releves-2025.xlsx : onglet « Synthèse »`;

const UNUSUAL = [
  "* étoiles\n* encore\n\n+ plus\n+ moins",
  "__gras__ et _italique_ et ~~barré~~ et `code`",
  "Titre\n=====\n\nSous-titre\n----------\n\nTexte  \navec saut de ligne",
  "  # Titre indenté\n\n   paragraphe indenté\r\nsur deux lignes\r\n",
  "1) premier\n2) second\n\n10. dix\n11. onze",
  "- [ ] à faire\n- [x] fait",
  "Texte<br>HTML ![image](https://example.com/a.png) [^1] et [référence][r].\n\n[r]: https://example.com\n\n[^1]: Une note.",
  "<div>\nbloc HTML\n</div>\n\nAprès.",
  "    code indenté\n    deux lignes\n\n```js\nconst a = 1;\n```\n\n~~~\ntilde\n~~~",
  "***\n\n- - -\n\n___",
  "> citation\nparesseuse\n\n> > imbriquée",
  "Voir https://example.com/a_b et www.example.org ou contact@example.com.",
  "| a | b |\n|---|---|\n| 1 |\n| 1 | 2 | 3 |",
  "\n\n  Texte avec des lignes vides au début et à la fin.\n\n\n",
  "- a\n\n  b\n- c\n\n\n- d",
  "Deux sauts\\\n\\\nde ligne",
  "",
];

describe("parseMarkdown and docToMarkdown", () => {
  it.each([AI_DRAFT, ...UNUSUAL])("gives back an untouched text byte for byte (%#)", (markdown) => {
    const { doc, origin } = load(markdown);
    expect(origin).not.toBeNull();
    expect(docToMarkdown(doc, origin)).toBe(markdown);
  });

  it.each([AI_DRAFT, ...UNUSUAL])("writes Markdown that reads back as the same document (%#)", (markdown) => {
    const written = rewrite(markdown);
    expect(load(written).doc.toJSON()).toEqual(load(markdown).doc.toJSON());
    // Writing it again changes nothing.
    expect(rewrite(written)).toBe(written);
  });

  it("writes an AI draft in the same style as it came", () => {
    expect(rewrite(AI_DRAFT)).toBe(AI_DRAFT.replace("| --- | ---: | :---: |", "| - | -: | :-: |"));
  });

  it("rewrites only the block that changed", () => {
    const markdown = "* un\n* deux\n\nAncien   paragraphe\navec __gras__.\n\n| a |\n|:-:|\n| 1 |\n";
    const { doc, origin } = load(markdown);
    const changed = replaceBlock(doc, 1, {
      type: "paragraph",
      content: [
        { type: "text", text: "Nouveau paragraphe avec " },
        { type: "text", text: "gras", marks: [{ type: "bold" }] },
        { type: "text", text: "." },
      ],
    });
    expect(docToMarkdown(changed, origin)).toBe(
      "* un\n* deux\n\nNouveau paragraphe avec **gras**.\n\n| a |\n|:-:|\n| 1 |\n",
    );
  });

  it("keeps the blocks around an added or removed one", () => {
    const markdown = "Premier.\n\n\nDeuxième.\nsuite\n\nTroisième.";
    const { doc, origin } = load(markdown);
    const added = doc.copy(doc.content.addToEnd(schema.nodeFromJSON(paragraph("Quatrième."))));
    expect(docToMarkdown(added, origin)).toBe("Premier.\n\n\nDeuxième.\nsuite\n\nTroisième.\n\nQuatrième.");
    const removed = doc.copy(doc.content.cut(0, doc.child(0).nodeSize + doc.child(1).nodeSize));
    expect(docToMarkdown(removed, origin)).toBe("Premier.\n\n\nDeuxième.\nsuite");
    const first = doc.copy(doc.content.cut(doc.child(0).nodeSize));
    expect(docToMarkdown(first, origin)).toBe("Deuxième.\nsuite\n\nTroisième.");
  });

  it("gives back the stored text after an undo, with equal but new nodes", () => {
    const markdown = "Un *texte*.\n\n- liste";
    const { doc, origin } = load(markdown);
    const copy = schema.nodeFromJSON(doc.toJSON());
    expect(copy.child(0)).not.toBe(doc.child(0));
    expect(docToMarkdown(copy, origin)).toBe(markdown);
  });

  it("keeps raw Markdown it can't show when its paragraph changes", () => {
    const markdown =
      "Avant ![schéma](https://example.com/s.png) <span>x</span> [^n] [lien][r].\n\n[r]: https://example.com\n\n[^n]: Note.";
    const { doc, origin } = load(markdown);
    const first = doc.child(0);
    const changed = replaceBlock(doc, 0, {
      ...first.toJSON(),
      content: [{ type: "text", text: "Après " }, ...first.toJSON().content.slice(1)],
    });
    expect(docToMarkdown(changed, origin)).toBe(markdown.replace("Avant ", "Après "));
  });

  it("keeps bold, italic and strikethrough around a plain address when its paragraph changes", () => {
    const markdown =
      "Voir **https://example.com**, ~~https://y.fr~~, _<https://z.fr>_ et **https://x.fr ou ailleurs**.";
    const { doc, origin } = load(markdown);
    const first = doc.child(0);
    const changed = replaceBlock(doc, 0, {
      ...first.toJSON(),
      content: [{ type: "text", text: "Lire " }, ...first.toJSON().content.slice(1)],
    });
    const written = docToMarkdown(changed, origin);
    expect(written).toBe(
      "Lire **https://example.com**, ~~https://y.fr~~, *https://z.fr* et **https://x.fr ou ailleurs**.",
    );
    expect(load(written).doc.toJSON()).toEqual(changed.toJSON());
  });

  it("keeps a link without text and a leading &nbsp; when their paragraph changes", () => {
    const markdown = "Voir [](https://example.com) ici.\n\n&nbsp;&nbsp;Texte en retrait.";
    const { doc, origin } = load(markdown);
    const first = doc.child(0);
    let changed = replaceBlock(doc, 0, {
      ...first.toJSON(),
      content: [{ type: "text", text: "Lire " }, ...first.toJSON().content.slice(1)],
    });
    expect(changed.child(1).textContent).toBe("\u00a0\u00a0Texte en retrait.");
    changed = replaceBlock(changed, 1, paragraph("\u00a0\u00a0Texte modifié."));
    const written = docToMarkdown(changed, origin);
    expect(written).toBe("Lire [](https://example.com) ici.\n\n\u00a0\u00a0Texte modifié.");
    expect(load(written).doc.toJSON()).toEqual(changed.toJSON());
  });

  it("writes two new lists of the same kind with different markers, so they stay apart", () => {
    const list = (text: string): JSONContent => ({
      type: "bulletList",
      content: [{ type: "listItem", content: [paragraph(text)] }],
    });
    expect(docToMarkdown(fromJson([list("a"), list("b"), list("c")]))).toBe("- a\n\n* b\n\n- c");

    // A new list next to a stored one: both are written again.
    const { doc, origin } = load("- stockée\n\nTexte.");
    const changed = replaceBlock(doc, 1, list("nouvelle"));
    const written = docToMarkdown(changed, origin);
    expect(written).toBe("- stockée\n\n* nouvelle");
    expect(load(written).doc.childCount).toBe(2);
  });

  it("writes indented code again when a list now comes before it", () => {
    const { doc, origin } = load("Texte.\n\n    code");
    const changed = replaceBlock(doc, 0, {
      type: "bulletList",
      content: [{ type: "listItem", content: [paragraph("point")] }],
    });
    expect(docToMarkdown(changed, origin)).toBe("- point\n\n```\ncode\n```");
  });

  it("closes a code fence that was left open once a block follows it", () => {
    const { doc, origin } = load("```\ncode");
    const added = doc.copy(doc.content.addToEnd(schema.nodeFromJSON(paragraph("Suite."))));
    expect(docToMarkdown(added, origin)).toBe("```\ncode\n```\n\nSuite.");
  });

  it("drops empty paragraphs and the spaces Markdown can't hold", () => {
    const doc = fromJson([
      { type: "paragraph" },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "  Un " },
          { type: "text", text: "mot ", marks: [{ type: "bold" }] },
          { type: "text", text: "important", marks: [{ type: "italic" }] },
          { type: "text", text: "   " },
          { type: "hardBreak" },
        ],
      },
      { type: "paragraph", content: [{ type: "text", text: "   " }] },
      { type: "paragraph", content: [{ type: "text", text: " \u00a0 " }] },
      { type: "heading", attrs: { level: 3 } },
      { type: "paragraph", content: [{ type: "hardBreak" }, { type: "text", text: "Fin" }] },
    ]);
    expect(docToMarkdown(doc)).toBe("Un **mot** *important*\n\nFin");
  });

  it("writes a line break inside a paragraph", () => {
    const doc = fromJson([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Ligne 1 " },
          { type: "hardBreak" },
          { type: "text", text: " Ligne 2" },
        ],
      },
    ]);
    expect(docToMarkdown(doc)).toBe("Ligne 1\\\nLigne 2");
    expect(load("Ligne 1\\\nLigne 2").doc.child(0).child(1).type.name).toBe("hardBreak");
  });

  it("nests marks the way Markdown reads them", () => {
    const doc = fromJson([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "gras ", marks: [{ type: "bold" }] },
          { type: "text", text: "et italique", marks: [{ type: "bold" }, { type: "italic" }] },
          { type: "text", text: " puis " },
          {
            type: "text",
            text: "lien gras",
            marks: [{ type: "bold" }, { type: "link", attrs: { href: "https://example.com" } }],
          },
          { type: "text", text: " et ", marks: [{ type: "link", attrs: { href: "https://example.com" } }] },
          {
            type: "text",
            text: "code",
            marks: [{ type: "code" }, { type: "link", attrs: { href: "https://example.com" } }],
          },
          { type: "text", text: " " },
          { type: "text", text: "barré", marks: [{ type: "strike" }] },
        ],
      },
    ]);
    expect(docToMarkdown(doc)).toBe(
      "**gras *et italique*** puis [**lien gras** et `code`](https://example.com) ~~barré~~",
    );
  });

  it("writes plain addresses as text, and other links in brackets", () => {
    const link = (text: string, href: string, title?: string): JSONContent => ({
      type: "text",
      text,
      marks: [{ type: "link", attrs: { href, title: title ?? null } }],
    });
    const doc = fromJson([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Voir " },
          link("https://example.com/page", "https://example.com/page"),
          { type: "text", text: ", " },
          link("www.example.org", "http://www.example.org"),
          { type: "text", text: ", " },
          link("contact@example.com", "mailto:contact@example.com"),
          { type: "text", text: ", " },
          link("le site", "https://example.com"),
          { type: "text", text: ", " },
          link("https://example.com/a_b", "https://example.com/a_b"),
          { type: "text", text: " et " },
          link("titre", "https://example.com", "Exemple"),
          { type: "text", text: "." },
        ],
      },
    ]);
    const written = docToMarkdown(doc);
    expect(written).toBe(
      'Voir https://example.com/page, www.example.org, contact@example.com, [le site](https://example.com), <https://example.com/a_b> et [titre](https://example.com "Exemple").',
    );
    expect(load(written).doc.toJSON()).toEqual(doc.toJSON());
  });

  it("escapes text that would read as Markdown", () => {
    const doc = fromJson([
      paragraph("1. pas une liste, 5 * 3 = 15, _a_ [x] <b>"),
      paragraph("# pas un titre"),
    ]);
    const written = docToMarkdown(doc);
    expect(written).toBe("1\\. pas une liste, 5 \\* 3 = 15, \\_a\\_ \\[x] \\<b>\n\n\\# pas un titre");
    expect(load(written).doc.toJSON()).toEqual(doc.toJSON());
  });

  it("writes tables with one line per cell and no merged cells", () => {
    const cell = (
      type: "tableHeader" | "tableCell",
      text: string,
      attrs: Record<string, unknown> = {},
    ): JSONContent => ({
      type,
      attrs,
      content: [text ? paragraph(text) : { type: "paragraph" }],
    });
    const doc = fromJson([
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              cell("tableHeader", "Poste", { colspan: 2 }),
              cell("tableHeader", "Part", { align: "right" }),
            ],
          },
          {
            type: "tableRow",
            content: [cell("tableCell", "Clim | froid"), cell("tableCell", ""), cell("tableCell", "58 %")],
          },
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      { type: "text", text: "Ligne" },
                      { type: "hardBreak" },
                      { type: "text", text: "suite" },
                    ],
                  },
                ],
              },
              cell("tableCell", "b"),
              cell("tableCell", "c"),
            ],
          },
        ],
      },
    ]);
    expect(docToMarkdown(doc)).toBe(
      "| Poste | | Part |\n| - | - | -: |\n| Clim \\| froid | | 58 % |\n| Ligne suite | b | c |",
    );
  });

  it("refuses a text too costly to parse", () => {
    expect(parseMarkdown(">".repeat(1000))).toBeNull();
  });
});
