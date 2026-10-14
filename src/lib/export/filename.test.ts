import { describe, expect, it } from "vitest";
import { exportFileName } from "./filename";

const DATE = new Date("2026-10-14T09:00:00Z");

describe("exportFileName", () => {
  it("writes the title in ASCII, lowercase, with hyphens", () => {
    expect(exportFileName("Étude thermique : bâtiment « Les Palmiers »", DATE, "docx")).toBe(
      "etude-thermique-batiment-les-palmiers-2026-10-14.docx",
    );
    expect(exportFileName("Maître d'œuvre & Cœur de ville", DATE, "pdf")).toBe(
      "maitre-d-oeuvre-coeur-de-ville-2026-10-14.pdf",
    );
    expect(exportFileName("  --Rapport_2026 (v2)!!  ", DATE, "pdf")).toBe("rapport-2026-v2-2026-10-14.pdf");
  });

  it("falls back to rapport when nothing is left", () => {
    expect(exportFileName("", DATE, "pdf")).toBe("rapport-2026-10-14.pdf");
    expect(exportFileName("« \u2014 »", DATE, "docx")).toBe("rapport-2026-10-14.docx");
    expect(exportFileName("报告 📄", DATE, "docx")).toBe("rapport-2026-10-14.docx");
  });

  it("keeps at most 80 characters of title, without a trailing hyphen", () => {
    const name = exportFileName(`${"a".repeat(79)} bcd`, DATE, "pdf");
    expect(name).toBe(`${"a".repeat(79)}-2026-10-14.pdf`);
    expect(exportFileName("x".repeat(300), DATE, "pdf")).toBe(`${"x".repeat(80)}-2026-10-14.pdf`);
  });

  it("uses the calendar day in Porto-Novo", () => {
    expect(exportFileName("Rapport", new Date("2026-10-13T22:59:59Z"), "pdf")).toBe("rapport-2026-10-13.pdf");
    expect(exportFileName("Rapport", new Date("2026-10-13T23:00:00Z"), "pdf")).toBe("rapport-2026-10-14.pdf");
    expect(exportFileName("Rapport", new Date("2026-12-31T23:30:00Z"), "docx")).toBe(
      "rapport-2027-01-01.docx",
    );
  });
});
