// @vitest-environment node
import { describe, expect, it } from "vitest";
import { EXPORT_MAX_CHARS, ExportTooLargeError, buildExport, exportChars } from ".";
import { SAMPLE_DOCUMENT } from "./test-document";

describe("buildExport", () => {
  it("builds the format asked for", async () => {
    expect((await buildExport(SAMPLE_DOCUMENT, "docx")).subarray(0, 2).toString("latin1")).toBe("PK");
    expect((await buildExport(SAMPLE_DOCUMENT, "pdf")).subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("refuses a report past the size limit of the format, before building it", async () => {
    const markdown = "a".repeat(EXPORT_MAX_CHARS.pdf);
    const doc = {
      ...SAMPLE_DOCUMENT,
      sections: [{ ...SAMPLE_DOCUMENT.sections[0]!, title: "Long", markdown }],
    };
    expect(exportChars(doc)).toBe(EXPORT_MAX_CHARS.pdf + 4);
    await expect(buildExport(doc, "pdf")).rejects.toBeInstanceOf(ExportTooLargeError);
    await expect(buildExport(doc, "pdf")).rejects.toMatchObject({
      format: "pdf",
      chars: EXPORT_MAX_CHARS.pdf + 4,
    });
  });
});
