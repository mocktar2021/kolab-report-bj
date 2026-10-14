// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadCases } from "../../evals/lib/case";
import { parseDeliverableFile } from "./deliverables/parse";
import {
  isRiskyMarkdown,
  markdownParseRisk,
  markdownRiskLimits,
  type MarkdownParseRisk,
} from "./markdown-risk";

type Rule = keyof MarkdownParseRisk;

/** The rules a text breaks. */
function brokenRules(text: string): Rule[] {
  const risk = markdownParseRisk(text);
  const limits = markdownRiskLimits(text.length);
  return (Object.keys(limits) as Rule[]).filter((rule) => risk[rule] > limits[rule]);
}

const wideTable = (columns: number, rows: number) =>
  "|a".repeat(columns) + "|\n" + "|-".repeat(columns) + "|\n" + "a\n".repeat(rows);

// Each of these takes seconds to minutes to parse or draw at this size,
// timed with remark-parse, remark-gfm and react-markdown (KRB-18).
const SLOW: [name: string, text: string, rule: Rule][] = [
  ["setext headings", "a\n=\n".repeat(25_000), "setext"],
  ["setext headings with dashes", "a\n-\n".repeat(25_000), "setext"],
  ["setext headings, 20 000 characters", "a\n=\n".repeat(5_000), "setext"],
  ["setext headings in a quote", "> a\n> =\n".repeat(12_500), "setext"],
  ["emphasis markers", "*a_".repeat(33_000), "emphasis"],
  ["closing brackets", "]".repeat(100_000), "emphasis"],
  ["unclosed links", "[a](".repeat(25_000), "emphasis"],
  ["a long paragraph of short lines", "a a\n".repeat(25_000), "inline"],
  ["a long paragraph of short lines, 20 000 characters", "a a\n".repeat(5_000), "inline"],
  ["lines that end in <", "x <a\n".repeat(20_000), "inline"],
  ["lines of pipes", "|a|\n".repeat(25_000), "inline"],
  ["escapes on one line", "a b\\.".repeat(20_000), "inline"],
  ["code spans on one line", "a b`c`".repeat(16_000), "inline"],
  ["character references on one line", "a b&amp;".repeat(12_500), "inline"],
  ["HTML tags on one line", "a b<a>".repeat(16_000), "inline"],
  ["email addresses on one line", "a b x@y.z ".repeat(10_000), "inline"],
  ["lazy lines in a quote", "> a\n" + "b\n".repeat(50_000), "containers"],
  ["lazy lines in a list", "- a\n" + "b\n".repeat(50_000), "containers"],
  ["quotes closed by blank lines", "> a\n\n".repeat(20_000), "containers"],
  ["quotes closed by blank lines, 20 000 characters", "> a\n\n".repeat(4_000), "containers"],
  ["quotes 60 deep closed by blank lines", ("> ".repeat(60) + "a\n\n").repeat(800), "containers"],
  ["quotes ended by headings", "> a\n# b\n".repeat(12_500), "containers"],
  ["nested lists", "- a\n  - b\n".repeat(10_000), "containers"],
  ["nested lists, 20 000 characters", "- a\n  - b\n".repeat(2_000), "containers"],
  ["lists ended by paragraphs", "- a\n\nb\n\n".repeat(12_500), "containers"],
  ["a wide table with one-cell rows", wideTable(2_000, 30_000), "tablePadding"],
  [
    "a wide table in a list item",
    "- " + "|a".repeat(2_000) + "|\n  " + "|-".repeat(2_000) + "|\n" + "  a\n".repeat(20_000),
    "tablePadding",
  ],
  ["a long tight list", "- a\n".repeat(25_000), "listItems"],
  ["quotes nested 50 000 deep", ">".repeat(50_000) + " citation", "prefix"],
];

describe("markdownParseRisk", () => {
  it.each(SLOW)("flags %s", (_name, text, rule) => {
    expect(brokenRules(text)).toContain(rule);
    expect(isRiskyMarkdown(text)).toBe(true);
  });

  it("reads Windows and old Mac line endings as line breaks", () => {
    expect(isRiskyMarkdown("a\r\n=\r\n".repeat(25_000))).toBe(true);
    expect(isRiskyMarkdown("a\r=\r".repeat(25_000))).toBe(true);
  });

  it("takes a few milliseconds on 100 000 characters", () => {
    for (const [, text] of SLOW) {
      const started = performance.now();
      markdownParseRisk(text.slice(0, 100_000));
      expect(performance.now() - started).toBeLessThan(200);
    }
  });
});

const SAMPLE = `# Titre

Texte avec **gras**, *italique*, ~~barré~~, \`code\` et un [lien](https://exemple.bj).

## Sous-titre

- un
- deux
  - deux point un
  - deux point deux
- trois

1. premier
2. second

> Une citation
> sur deux lignes.

| A | B |
| :- | -: |
| 1 | 2 |

\`\`\`sql
SELECT 1;
\`\`\`

Titre souligné
==============

Autre titre
-----------

Note[^1] et <https://exemple.bj/rapport>.

[^1]: La note.`;

/** About 1 000 characters of a report, with a bit of every kind of block. */
function reportPart(index: number): string {
  return `## Constat sur le site ${index}

Le **constat** porte sur la *façade nord* et la toiture. Les relevés du 12/03 montrent une perte de 18 % : voir le [plan](https://exemple.bj/plan) et l'annexe B. L'équipe a noté l'état de chaque pièce, puis a comparé avec le relevé de l'année précédente.

Points relevés
--------------

- Fissures sur le mur pignon, côté rue.
- Infiltrations au niveau des menuiseries :
  - fenêtre de la cuisine ;
  - porte d'entrée.
- Isolation absente sous la dalle.

| Zone | Mesure | Écart |
| :--- | ---: | :---: |
| Nord | 24 °C | +2 |
| Sud | 27 °C | +5 |
| Est | 25 °C | +3 |

> Le maître d'ouvrage demande un chiffrage avant la fin du mois.
> Contact : contact@exemple.bj

1. Reprendre les fissures.
2. Remplacer les joints.
3. Poser un isolant de 10 cm.

\`\`\`text
T1 = 24.0
T2 = 27.5
\`\`\`

Voir aussi www.exemple.bj et <https://exemple.bj/rapport>, ainsi que la note[^n${index}].

[^n${index}]: Mesures prises par temps sec, entre 9 h et 11 h.
`;
}

/** Text wrapped at 72 columns, in paragraphs of eight lines. */
function wrappedText(characters: number): string {
  const words =
    "Les relevés de température montrent un écart régulier entre les pièces exposées au nord et les autres.".split(
      " ",
    );
  const lines: string[] = [];
  let line = "";
  let length = 0;
  for (let index = 0; length < characters; index++) {
    const word = words[index % words.length]!;
    if (line.length + word.length + 1 > 72) {
      lines.push(line);
      length += line.length + 1;
      if (lines.length % 9 === 8) lines.push("");
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  return lines.join("\n");
}

describe("isRiskyMarkdown", () => {
  it("lets ordinary Markdown through", () => {
    expect(brokenRules(SAMPLE)).toEqual([]);
    expect(brokenRules("")).toEqual([]);
  });

  it("lets a long report through", () => {
    const report = Array.from({ length: 210 }, (_, index) => reportPart(index + 1)).join("\n");
    expect(report.length).toBeGreaterThan(200_000);
    // A section holds 100 000 characters at most, a deliverable 200 000.
    expect(brokenRules(report.slice(0, 100_000))).toEqual([]);
    expect(brokenRules(report)).toEqual([]);
    expect(brokenRules(wrappedText(200_000))).toEqual([]);
  });

  it("gives longer texts higher limits, except for nesting and emphasis", () => {
    expect(markdownRiskLimits(1_000)).toEqual(markdownRiskLimits(50_000));
    const long = markdownRiskLimits(200_000);
    const short = markdownRiskLimits(50_000);
    expect(long.inline).toBe(4 * short.inline);
    expect(long.containers).toBe(4 * short.containers);
    expect(long.prefix).toBe(short.prefix);
    expect(long.emphasis).toBe(short.emphasis);
  });

  it("lets big tables, long lists and many headings through", () => {
    const table = "| Zone | Mesure |\n| --- | --- |\n" + "| **Nord** | *24 °C* |\n".repeat(3_000);
    expect(brokenRules(table)).toEqual([]);
    expect(brokenRules("- point à vérifier\n".repeat(1_000))).toEqual([]);
    expect(brokenRules("Titre\n=====\n\nTexte du paragraphe.\n\n".repeat(150))).toEqual([]);
    expect(brokenRules("# Titre\n\nTexte du paragraphe.\n\n".repeat(2_000))).toEqual([]);
  });

  it("lets the golden set and the test files through", async () => {
    const texts: [string, string][] = [];
    for (const value of loadCases()) {
      texts.push([`${value.id}: reference`, value.reference.markdown]);
      for (const deliverable of value.input.deliverables)
        texts.push([`${value.id}: ${deliverable.fileName}`, deliverable.markdown]);
    }
    for (const [extension, name] of [
      ["docx", "etude-thermique.docx"],
      ["csv", "releves.csv"],
    ] as const) {
      const bytes = readFileSync(new URL(`../../tests/fixtures/deliverables/${name}`, import.meta.url));
      const result = await parseDeliverableFile(extension, bytes);
      if (result.status === "parsed") texts.push([name, result.markdown]);
    }
    expect(texts.length).toBeGreaterThan(30);
    for (const [name, text] of texts) expect(brokenRules(text), name).toEqual([]);
  });
});
