import { describe, expect, it } from "vitest";
import messages from "../../../messages/fr.json";
import { SECTION_STATUSES } from "@/lib/sections";
import {
  STATUS_LABELS,
  UNASSIGNED_LABEL,
  formatExportDate,
  generatedOn,
  pageLabel,
  sectionMeta,
} from "./labels";

describe("export labels", () => {
  it("match the status names of messages/fr.json", () => {
    expect(STATUS_LABELS).toEqual(messages.SectionStatus);
    expect(Object.keys(STATUS_LABELS).sort()).toEqual([...SECTION_STATUSES].sort());
  });

  it("name an unassigned section like the report page", () => {
    expect(UNASSIGNED_LABEL).toBe(messages.Report.unassigned);
    expect(sectionMeta(null, "in_progress")).toBe("Responsable : Non attribuée · Statut : En cours");
    expect(sectionMeta("  ", "completed")).toBe("Responsable : Non attribuée · Statut : Terminée");
    expect(sectionMeta("Fatou Dossou", "not_started")).toBe(
      "Responsable : Fatou Dossou · Statut : Non commencée",
    );
  });

  it("write the date in French, in Porto-Novo time", () => {
    // 23:30 UTC is already the next day in Porto-Novo (UTC+1).
    expect(formatExportDate(new Date("2026-10-13T23:30:00Z"))).toBe("14 octobre 2026");
    expect(generatedOn(new Date("2026-02-01T10:00:00Z"))).toBe("Généré le 1 février 2026");
  });

  it("number pages in French", () => {
    expect(pageLabel(3, 12)).toBe("Page 3 sur 12");
  });
});
