// @vitest-environment node
import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "./html-to-markdown";

const md = (html: string) => htmlToMarkdown(html).markdown.trimEnd();

describe("htmlToMarkdown blocks", () => {
  it("turns h1 to h6 into Markdown headings and drops empty ones", () => {
    expect(md("<h1>Titre</h1><h2>Partie</h2><h3>a</h3><h4>b</h4><h5>c</h5><h6>d</h6><h2> </h2>")).toBe(
      "# Titre\n\n## Partie\n\n### a\n\n#### b\n\n##### c\n\n###### d",
    );
  });

  it("separates paragraphs, collapses whitespace and drops empty paragraphs", () => {
    expect(md("<p>Un</p><p>  deux \n  mots  </p><p> </p><p></p><p>Trois</p>")).toBe(
      "Un\n\ndeux mots\n\nTrois",
    );
  });

  it("keeps text from unknown wrappers and loose text", () => {
    expect(md("<div><p>Dans un div</p></div>Texte libre")).toBe("Dans un div\n\nTexte libre");
  });

  it("decodes entities and keeps accents", () => {
    expect(md("<p>R&amp;D &laquo;&eacute;t&eacute;&raquo; 1&nbsp;000,50&nbsp;&euro; œuvre</p>")).toBe(
      "R&D «été» 1 000,50 € œuvre",
    );
  });
});

describe("htmlToMarkdown emphasis", () => {
  it("renders bold, italic and strike from either tag name", () => {
    expect(
      md("<p><strong>a</strong> <b>b</b> <em>c</em> <i>d</i> <s>e</s> <del>f</del> <strike>g</strike></p>"),
    ).toBe("**a** **b** *c* *d* ~~e~~ ~~f~~ ~~g~~");
  });

  it("keeps the surrounding spaces outside the markers", () => {
    expect(md("<p>Un<strong> gras </strong>mot et<em> italique</em>, puis<s>barré </s>fin</p>")).toBe(
      "Un **gras** mot et *italique*, puis~~barré~~ fin",
    );
  });

  it("leaves blank emphasis as plain space", () => {
    expect(md("<p>a<strong> </strong>b<em></em>c</p>")).toBe("a bc");
  });

  it("nests emphasis", () => {
    expect(md("<p><strong>Gras <em>et italique</em></strong></p>")).toBe("**Gras *et italique***");
  });
});

describe("htmlToMarkdown links", () => {
  it.each([
    ["https://exemple.bj/rapport", "[rapport](<https://exemple.bj/rapport>)"],
    ["http://exemple.bj", "[rapport](<http://exemple.bj>)"],
    ["HTTPS://EXEMPLE.BJ", "[rapport](<HTTPS://EXEMPLE.BJ>)"],
    ["mailto:contact@exemple.bj", "[rapport](<mailto:contact@exemple.bj>)"],
  ])("keeps a safe link to %s", (href, expected) => {
    expect(md(`<p><a href="${href}">rapport</a></p>`)).toBe(expected);
  });

  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    " javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "/fr/espaces",
    "rapport.docx",
    "#footnote-1",
    "//exemple.bj",
    "ftp://exemple.bj",
  ])("renders a link to %s as plain text", (href) => {
    expect(md(`<p>Voir <a href="${href}">le rapport</a>.</p>`)).toBe("Voir le rapport.");
  });

  it("renders a link without href as plain text", () => {
    expect(md('<p><a id="bookmark">Ancre</a></p>')).toBe("Ancre");
  });

  it("encodes spaces and angle brackets in the target", () => {
    expect(md('<p><a href="https://exemple.bj/mon rapport&lt;1&gt;.pdf">pdf</a></p>')).toBe(
      "[pdf](<https://exemple.bj/mon%20rapport%3C1%3E.pdf>)",
    );
  });

  it("keeps the spaces around the link text outside the brackets", () => {
    expect(md('<p>voir le<a href="https://exemple.bj"> rapport </a>et la suite</p>')).toBe(
      "voir le [rapport](<https://exemple.bj>) et la suite",
    );
  });

  it("escapes brackets in the link text and keeps emphasis", () => {
    expect(md('<p><a href="https://exemple.bj">[1] <strong>note</strong></a></p>')).toBe(
      "[\\[1\\] **note**](<https://exemple.bj>)",
    );
  });

  it("drops a link that only holds an image", () => {
    expect(md('<p><a href="https://exemple.bj"><img src="logo.png" alt="Logo"/></a></p>')).toBe("");
  });
});

describe("htmlToMarkdown text", () => {
  it("escapes the characters that would become Markdown", () => {
    expect(md("<p>2*3, fichier_nom, [note], `code`, C:\\dossier</p>")).toBe(
      "2\\*3, fichier\\_nom, \\[note\\], \\`code\\`, C:\\\\dossier",
    );
  });

  it("escapes heading text too", () => {
    expect(md("<h2>Lot *A* _bis_</h2>")).toBe("## Lot \\*A\\* \\_bis\\_");
  });

  it("keeps a paragraph that starts like a heading, quote, list or rule as a paragraph", () => {
    expect(
      md(
        "<p>1984. Le bâtiment</p><p># pas un titre</p><p>&gt; pas une citation</p><p>- 5 °C</p><p>+33 1 00</p><p>2) suite</p><p>---</p><p>===</p>",
      ),
    ).toBe(
      "1984\\. Le bâtiment\n\n\\# pas un titre\n\n\\> pas une citation\n\n\\- 5 °C\n\n\\+33 1 00\n\n2\\) suite\n\n\\---\n\n\\===",
    );
  });

  it("escapes block starts after a line break and at the start of a list item", () => {
    expect(md("<p>Avant<br/>- après<br/> &gt; cité</p><ul><li>1. premier</li><li># deux</li></ul>")).toBe(
      "Avant  \n\\- après  \n \\> cité\n\n- 1\\. premier\n- \\# deux",
    );
  });

  it("keeps the closing # of a heading as text", () => {
    expect(md("<h2>Langage C #</h2><h3>#</h3><h3>C#</h3>")).toBe("## Langage C \\#\n\n### \\#\n\n### C#");
  });

  it("escapes strikethrough, pipes, tags and entities written as text", () => {
    expect(md("<p>~~non barré~~ a | b &lt;b&gt;gras&lt;/b&gt; &amp;eacute; 3 &lt; 4 &amp; 5</p>")).toBe(
      "\\~\\~non barré\\~\\~ a \\| b \\<b>gras\\</b> \\&eacute; 3 < 4 & 5",
    );
  });

  it("turns <br> into a hard break in paragraphs and a space in headings", () => {
    expect(md("<p>Ligne 1<br/>Ligne 2<br>Ligne 3</p><h2>Titre<br/>suite</h2>")).toBe(
      "Ligne 1  \nLigne 2  \nLigne 3\n\n## Titre suite",
    );
  });

  it("drops a <br> at the end of a paragraph", () => {
    expect(md("<p>Fin<br/></p><p>Suite</p>")).toBe("Fin\n\nSuite");
  });

  it("drops images and their data", () => {
    const markdown = md(
      '<p>Avant <img src="data:image/png;base64,iVBORw0KGgo=" alt="Logo"/> après</p><p><img src="x.png"/></p>',
    );
    expect(markdown).toMatch(/^Avant +après$/);
    expect(markdown).not.toMatch(/Logo|base64|data:|!\[/);
  });
});

describe("htmlToMarkdown lists", () => {
  it("renders nested lists with the indentation of their marker", () => {
    const html =
      "<ul><li>Un</li><li>Deux<ul><li>Deux A</li><li>Deux B<ol><li>Premier</li><li>Second</li></ol></li></ul></li><li>Trois</li></ul>";
    expect(md(html)).toBe(
      ["- Un", "- Deux", "  - Deux A", "  - Deux B", "    1. Premier", "    2. Second", "- Trois"].join("\n"),
    );
  });

  it("indents under wide numbers", () => {
    const items = Array.from({ length: 9 }, (_, index) => `<li>Item ${index + 1}</li>`).join("");
    const markdown = md(`<ol>${items}<li>Item 10<ul><li>Sous-item</li></ul></li></ol>`);
    expect(markdown.split("\n").slice(-3)).toEqual(["9. Item 9", "10. Item 10", "    - Sous-item"]);
  });

  it("joins paragraphs and inline content of an item on one line", () => {
    expect(md("<ul><li><p>Premier</p><p>suite <strong>grasse</strong></p></li><li>a<br/>b</li></ul>")).toBe(
      "- Premier suite **grasse**\n- a b",
    );
  });

  it("separates a list from the next block", () => {
    expect(md("<ol><li>a</li></ol><p>Après</p>")).toBe("1. a\n\nAprès");
  });
});

describe("htmlToMarkdown tables", () => {
  it("renders a simple table with the first row as header", () => {
    const { markdown, tables } = htmlToMarkdown(
      "<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>",
    );
    expect(markdown.trimEnd()).toBe("| A | B |\n| --- | --- |\n| 1 | 2 |");
    expect(tables).toBe(1);
  });

  it("spreads colspan and rowspan over the grid", () => {
    const html = `<table>
      <tr><td>A</td><td colspan="2">B</td><td>C</td></tr>
      <tr><td rowspan="2">D</td><td>E</td><td rowspan="2" colspan="2">F</td></tr>
      <tr><td>G</td></tr>
      <tr><td>H</td><td>I</td><td>J</td><td>K</td></tr>
    </table>`;
    expect(md(html)).toBe(
      [
        "| A | B |   | C |",
        "| --- | --- | --- | --- |",
        "| D | E | F |   |",
        "|   | G |   |   |",
        "| H | I | J | K |",
      ].join("\n"),
    );
  });

  it("drops rows a rowspan reaches past the last row", () => {
    expect(md('<table><tr><td rowspan="5">A</td><td>B</td></tr><tr><td>C</td></tr></table>')).toBe(
      "| A | B |\n| --- | --- |\n|   | C |",
    );
  });

  it("treats invalid spans as 1 and caps large ones at 50", () => {
    expect(
      md('<table><tr><td colspan="0">a</td><td rowspan="-2">b</td><td colspan="x">c</td></tr></table>'),
    ).toBe("| a | b | c |\n| --- | --- | --- |");
    const header = md('<table><tr><td colspan="999">A</td></tr><tr><td>B</td></tr></table>').split("\n")[0];
    expect(header?.split(" | ")).toHaveLength(50);
  });

  it("pads short rows to the widest row", () => {
    expect(md("<table><tr><td>a</td></tr><tr><td>b</td><td>c</td><td>d</td></tr></table>")).toBe(
      "| a |   |   |\n| --- | --- | --- |\n| b | c | d |",
    );
  });

  it("escapes Markdown and pipes in cells", () => {
    expect(md("<table><tr><td>a|b</td><td>*x* _y_ [z] `c` \\</td></tr></table>")).toBe(
      "| a\\|b | \\*x\\* \\_y\\_ \\[z\\] \\`c\\` \\\\ |\n| --- | --- |",
    );
  });

  it("turns <br> and paragraphs in a cell into spaces", () => {
    expect(md("<table><tr><td><p>Ligne 1<br/>Ligne 2</p><p>Ligne 3</p></td></tr></table>")).toBe(
      "| Ligne 1 Ligne 2 Ligne 3 |\n| --- |",
    );
  });

  it("keeps emphasis and links in cells", () => {
    expect(
      md(
        '<table><tr><td><strong>Total</strong></td><td><a href="https://exemple.bj">site</a></td></tr></table>',
      ),
    ).toBe("| **Total** | [site](<https://exemple.bj>) |\n| --- | --- |");
  });

  it("encodes backslashes in a link target and keeps its pipes inside the cell", () => {
    expect(md('<table><tr><td><a href="https://x.bj/a\\|b|c">lien</a></td><td>z</td></tr></table>')).toBe(
      "| [lien](<https://x.bj/a%5C\\|b\\|c>) | z |\n| --- | --- |",
    );
  });

  it("joins a list in a cell with semicolons", () => {
    expect(md("<table><tr><td><ul><li>a</li><li>b <em>c</em></li></ul></td></tr></table>")).toBe(
      "| a; b *c* |\n| --- |",
    );
  });

  it("flattens a nested table into its cell, one space between cells", () => {
    const { markdown, tables } = htmlToMarkdown(
      "<table><tr><th>Lot</th><th>Détail</th></tr><tr><td>1</td><td><p>Voir :</p>" +
        "<table><tr><td><p>Sous-lot A</p></td><td><p>12 €</p></td></tr>" +
        "<tr><td><p>Sous-lot_B</p></td><td><p>8 €</p></td></tr></table></td></tr></table>",
    );
    expect(markdown.trimEnd()).toBe(
      "| Lot | Détail |\n| --- | --- |\n| 1 | Voir : Sous-lot A 12 € Sous-lot\\_B 8 € |",
    );
    expect(tables).toBe(1);
  });

  it("keeps paragraphs apart in nested cells and in lists inside cells", () => {
    expect(
      md(
        "<table><tr><td><table><tr><td><p>a</p><p>b</p></td><td></td><td>c</td></tr></table></td>" +
          "<td><ul><li><p>d</p><p>e</p></li><li>f</li></ul></td></tr></table>",
      ),
    ).toBe("| a b c | d e; f |\n| --- | --- |");
  });

  it("flattens a table nested two levels deep", () => {
    expect(
      md(
        "<table><tr><td><table><tr><td>a</td><td><table><tr><td>b</td><td>c</td></tr></table></td></tr></table></td></tr></table>",
      ),
    ).toBe("| a b c |\n| --- |");
  });

  it("counts every top level table", () => {
    const { markdown, tables } = htmlToMarkdown(
      "<table><tr><td>a</td></tr></table><p>Entre</p><table><tr><td>b</td></tr></table>",
    );
    expect(tables).toBe(2);
    expect(markdown.trimEnd()).toBe("| a |\n| --- |\n\nEntre\n\n| b |\n| --- |");
  });
});
