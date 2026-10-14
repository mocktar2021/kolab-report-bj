import { describe, expect, it } from "vitest";
import {
  EXPORT_LIMITS,
  TOP_PLACE,
  cleanLine,
  cleanText,
  linkText,
  nest,
  parseRisk,
  runsText,
  sectionBlocks,
  type Block,
} from "./markdown";

function only<T extends Block["type"]>(blocks: Block[], type: T): Extract<Block, { type: T }> {
  expect(blocks).toHaveLength(1);
  const [block] = blocks;
  expect(block?.type).toBe(type);
  return block as Extract<Block, { type: T }>;
}

function paragraphText(markdown: string): string {
  return runsText(only(sectionBlocks(markdown), "paragraph").runs);
}

describe("cleanText", () => {
  it("strips NUL and control characters but keeps tabs and line breaks", () => {
    expect(cleanText("a\u0000b\u0007c\td\r\ne\rf\u001bg\u007fh\u0085i")).toBe("abc\td\ne\nfghi");
  });

  it("replaces a lone surrogate and the characters XML refuses", () => {
    expect(cleanText("x\ud83dy\uffffz")).toBe("x\ufffdyz");
  });

  it("keeps French text as is", () => {
    expect(cleanText("Œuvre « été » à 12 € \u2013 déjà")).toBe("Œuvre « été » à 12 € \u2013 déjà");
  });

  it("puts a title on one line", () => {
    expect(cleanLine("  Rapport\n\tfinal\u0000  ")).toBe("Rapport final");
  });
});

describe("linkText", () => {
  it("shows the address after the text", () => {
    expect(linkText("le rapport", "https://exemple.bj/rapport")).toBe(
      "le rapport (https://exemple.bj/rapport)",
    );
  });

  it("shows the address once when the text already is the address", () => {
    expect(linkText("https://exemple.bj", "https://exemple.bj")).toBe("https://exemple.bj");
    expect(linkText("www.exemple.bj", "http://www.exemple.bj")).toBe("www.exemple.bj");
    expect(linkText("contact@exemple.bj", "mailto:contact@exemple.bj")).toBe("contact@exemple.bj");
  });

  it("shows the address when there is no text", () => {
    expect(linkText(" ", "https://exemple.bj")).toBe("https://exemple.bj");
  });
});

describe("sectionBlocks", () => {
  it("gives nothing for an empty section", () => {
    expect(sectionBlocks(null)).toEqual([]);
    expect(sectionBlocks(" \n\t\n")).toEqual([]);
    expect(sectionBlocks("\u0000")).toEqual([]);
  });

  it("turns links into their text and address, never a link", () => {
    expect(paragraphText("Voir le [rapport](https://exemple.bj/r) et <https://exemple.bj/a>.")).toBe(
      "Voir le rapport (https://exemple.bj/r) et https://exemple.bj/a.",
    );
    expect(paragraphText("Voir [le plan][plan].\n\n[plan]: https://exemple.bj/plan")).toBe(
      "Voir le plan (https://exemple.bj/plan).",
    );
    expect(paragraphText("[](javascript:alert(1))")).toBe("javascript:alert(1)");
  });

  it("keeps the marks of a link's text, the address takes the marks around the link", () => {
    const runs = only(sectionBlocks("*voir [**gras**](https://exemple.bj)*"), "paragraph").runs;
    expect(runs).toEqual([
      { text: "voir ", italic: true },
      { text: "gras", bold: true, italic: true },
      { text: " (https://exemple.bj)", italic: true },
    ]);
  });

  it("draws an image as its alt text and never its address", () => {
    expect(paragraphText("Avant ![Plan du site](https://exemple.bj/plan.png) après")).toBe(
      "Avant Plan du site après",
    );
    expect(sectionBlocks("![](https://exemple.bj/pixel.png)")).toEqual([]);
  });

  it("keeps raw HTML as plain text", () => {
    expect(only(sectionBlocks("Un <b>mot</b> en gras"), "paragraph").runs).toEqual([
      { text: "Un <b>mot</b> en gras" },
    ]);
    expect(paragraphText('<script>alert("x")</script>')).toBe('<script>alert("x")</script>');
    expect(paragraphText("<img src=x onerror=alert(1)>")).toBe("<img src=x onerror=alert(1)>");
  });

  it("strips control characters from the text", () => {
    expect(paragraphText("a\u0000b\u0008c")).toBe("abc");
  });

  it("keeps bold, italic, code and strikethrough as marks", () => {
    expect(only(sectionBlocks("**g** *i* `c` ~~s~~ ***gi***"), "paragraph").runs).toEqual([
      { text: "g", bold: true },
      { text: " " },
      { text: "i", italic: true },
      { text: " " },
      { text: "c", code: true },
      { text: " " },
      { text: "s", strike: true },
      { text: " " },
      { text: "gi", bold: true, italic: true },
    ]);
  });

  it("reads soft line endings as spaces and hard ones as breaks", () => {
    expect(paragraphText("un\ndeux  \ntrois")).toBe("un deux\ntrois");
  });

  it("reads headings, rules, quotes and code blocks", () => {
    const blocks = sectionBlocks("# Titre\n\n---\n\n> cité\n\n```sql\nSELECT 1;\n\tFROM t\n```");
    expect(blocks).toEqual([
      { type: "heading", depth: 1, runs: [{ text: "Titre" }] },
      { type: "rule" },
      { type: "quote", blocks: [{ type: "paragraph", runs: [{ text: "cité" }] }] },
      { type: "code", text: "SELECT 1;\n    FROM t" },
    ]);
  });

  it("reads nested and numbered lists", () => {
    const list = only(sectionBlocks("3. trois\n4. quatre\n   - a\n     - b"), "list");
    expect(list).toMatchObject({ ordered: true, start: 3 });
    expect(list.items[1]?.blocks[1]).toMatchObject({
      type: "list",
      ordered: false,
      items: [
        { blocks: [{ type: "paragraph" }, { type: "list", items: [{ blocks: [{ type: "paragraph" }] }] }] },
      ],
    });
    const tasks = sectionBlocks("- [x] fait\n- [ ] à faire")[0];
    expect(tasks).toMatchObject({ type: "list", items: [{ checked: true }, { checked: false }] });
  });

  it("reads a table with its alignment, and pads short rows", () => {
    const table = only(sectionBlocks("| A | B | C |\n| :- | :-: | -: |\n| 1 | **2** |"), "table");
    expect(table.align).toEqual(["left", "center", "right"]);
    expect(table.rows).toEqual([
      [[{ text: "A" }], [{ text: "B" }], [{ text: "C" }]],
      [[{ text: "1" }], [{ text: "2", bold: true }], []],
    ]);
  });

  it("merges the columns past the limit into the last one, cut when long", () => {
    const columns = 500;
    const row = (cell: (index: number) => string) =>
      `|${Array.from({ length: columns }, (_, index) => cell(index)).join("|")}|`;
    const markdown = [row((i) => `h${i}`), row(() => "-"), row((i) => `c${i}`)].join("\n");
    const table = only(sectionBlocks(markdown), "table");
    expect(table.align).toHaveLength(EXPORT_LIMITS.tableColumns);
    for (const cells of table.rows) expect(cells).toHaveLength(EXPORT_LIMITS.tableColumns);
    const last = runsText(table.rows[1]![EXPORT_LIMITS.tableColumns - 1]!);
    expect(last.startsWith("c19 | c20 | c21")).toBe(true);
    expect(last.endsWith("…")).toBe(true);
    expect(last.length).toBe(EXPORT_LIMITS.mergedCellChars + 1);

    const few = only(sectionBlocks(`|${"h|".repeat(22)}\n|${"-|".repeat(22)}\n|${"c|".repeat(22)}`), "table");
    expect(runsText(few.rows[1]![EXPORT_LIMITS.tableColumns - 1]!)).toBe("c | c | c");
  });

  it("keeps the label of a footnote", () => {
    const blocks = sectionBlocks("Texte[^1].\n\n[^1]: La note.");
    expect(blocks.map((block) => block.type === "paragraph" && runsText(block.runs))).toEqual([
      "Texte[1].",
      "[1] La note.",
    ]);
  });
});

describe("limits", () => {
  it("caps the depth of lists and quotes", () => {
    let place = TOP_PLACE;
    for (let level = 0; level < 50; level++) place = nest(place, level % 2 ? "quotes" : "lists");
    expect(place.lists + place.quotes).toBe(EXPORT_LIMITS.depth);
  });

  it("reads a list 50 levels deep", () => {
    const markdown = Array.from({ length: 50 }, (_, level) => `${"  ".repeat(level)}- niveau ${level}`).join(
      "\n",
    );
    let block = sectionBlocks(markdown)[0];
    let depth = 0;
    while (block?.type === "list") {
      depth++;
      block = block.items[0]?.blocks[1];
    }
    expect(depth).toBe(50);
  });

  it("shows text that would make the parser slow as plain paragraphs, quickly", () => {
    const cases = [
      "*_".repeat(25_000) + "x" + "_*".repeat(25_000),
      "*_\n".repeat(8_000) + "x" + "\n_*".repeat(8_000),
      "[a](".repeat(25_000),
      ">".repeat(50_000) + " citation",
      "| *_*_*_*_ |\n".repeat(5_000),
    ];
    for (const markdown of cases) {
      const started = performance.now();
      const blocks = sectionBlocks(markdown);
      expect(performance.now() - started).toBeLessThan(1_000);
      expect(blocks.every((block) => block.type === "paragraph")).toBe(true);
    }
  });

  it("parses long ordinary text and big tables with emphasis", () => {
    const table = "| Zone | Mesure |\n| --- | --- |\n" + "| **Nord** | *24 °C* |\n".repeat(3_000);
    expect(parseRisk(table).emphasis).toBeLessThan(EXPORT_LIMITS.emphasisRisk);
    expect(only(sectionBlocks(table), "table").rows).toHaveLength(3_001);

    const report = "Le **constat** porte sur la *façade* et le [plan](https://exemple.bj).\n\n".repeat(1_000);
    expect(sectionBlocks(report)).toHaveLength(1_000);
  });

  it("counts lines that only look like table rows as one paragraph", () => {
    const fake = "| a |\n" + "| *_*_ |\n".repeat(10);
    expect(parseRisk(fake).emphasis).toBe(40 * 40);
    const real = "| a |\n| - |\n" + "| *_*_ |\n".repeat(10);
    expect(parseRisk(real).emphasis).toBe(10 * 4 * 4);
  });

  it("measures the deepest line prefix", () => {
    expect(parseRisk("> > - 1. texte").prefix).toBe(9);
    expect(parseRisk("texte").prefix).toBe(0);
  });
});
