// @vitest-environment node
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseDocx } from "./docx";
import { ParseError, type ParseResult } from "./types";

// Built by tests/fixtures/deliverables/make-fixtures.py.
const fixture = (name: string) =>
  readFileSync(new URL(`../../../../tests/fixtures/deliverables/${name}`, import.meta.url));

function parsed(result: ParseResult) {
  if (result.status !== "parsed") throw new Error(`expected a parsed result, got ${result.status}`);
  return result;
}

const EXPECTED = `# Étude thermique du bâtiment

Le maître d'œuvre a mesuré la façade sud à Porto-Novo : «chaleur très élevée» en après-midi, pour un coût de 1 000,50 €.

## Constats

Le confort d'été est **très faible** dans les *chambres du nord*, voir le [rapport complet](<https://exemple.bj/rapport>) et l'~~ancienne étude~~.

Plan :

- Murs extérieurs
  - Isolation en laine de roche
  - Enduit à la chaux
- Toiture en tôle

Étapes de l'étude :

1. Mesurer les températures
2. Calculer les apports solaires
3. Rédiger les recommandations

## Mesures

| Zone | Température | Humidité |
| --- | --- | --- |
| Façade nord | 24,5 °C | 60 % |
|   | Capteur en panne |   |
| Toiture | 38 °C | 35 % |

Fin du rapport.`;

describe("parseDocx on etude-thermique.docx", () => {
  it("gives the whole document as Markdown", async () => {
    const { markdown } = parsed(await parseDocx(fixture("etude-thermique.docx")));
    expect(markdown).toBe(EXPECTED);
  });

  it("keeps headings, the link, the nested list and the merged cells", async () => {
    const { markdown } = parsed(await parseDocx(fixture("etude-thermique.docx")));
    const lines = markdown.split("\n");
    expect(lines).toContain("# Étude thermique du bâtiment");
    expect(lines.filter((line) => line.startsWith("## "))).toEqual(["## Constats", "## Mesures"]);
    expect(markdown).toContain("[rapport complet](<https://exemple.bj/rapport>)");
    expect(markdown).toContain(
      "- Murs extérieurs\n  - Isolation en laine de roche\n  - Enduit à la chaux\n- Toiture",
    );
    expect(markdown).toContain("| Façade nord | 24,5 °C | 60 % |\n|   | Capteur en panne |   |");
  });

  it("keeps accents, ligatures, guillemets and the euro sign", async () => {
    const { markdown } = parsed(await parseDocx(fixture("etude-thermique.docx")));
    for (const text of ["é", "è", "à", "ç", "œ", "«chaleur très élevée»", "1 000,50 €"]) {
      expect(markdown).toContain(text);
    }
    expect(markdown).not.toMatch(/�|Ã/);
  });

  it("drops the image, its alt text and its data", async () => {
    const { markdown } = parsed(await parseDocx(fixture("etude-thermique.docx")));
    expect(markdown).toContain("\nPlan :\n");
    expect(markdown).not.toMatch(/Plan du bâtiment|image1|base64|data:|!\[|<img/);
  });

  it("measures the Markdown", async () => {
    const { markdown, meta } = parsed(await parseDocx(fixture("etude-thermique.docx")));
    expect(meta).toEqual({
      version: 1,
      kind: "document",
      tables: 1,
      words: expect.any(Number),
      characters: markdown.length,
      tokenEstimate: Math.ceil(markdown.length / 4),
      truncated: false,
    });
    expect(meta.words).toBeGreaterThan(50);
  });
});

describe("parseDocx on files it cannot read", () => {
  it("refuses illisible.docx as corrupt before opening it", async () => {
    const bytes = fixture("illisible.docx");
    expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const failure = parseDocx(bytes);
    await expect(failure).rejects.toBeInstanceOf(ParseError);
    await expect(failure).rejects.toMatchObject({ key: "corrupt" });
  });

  it("calls a valid ZIP without a Word document unreadable", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Feuille").getCell("A1").value = "pas un docx";
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
    const failure = parseDocx(bytes);
    await expect(failure).rejects.toBeInstanceOf(ParseError);
    await expect(failure).rejects.toMatchObject({ key: "unreadable" });
  });
});
