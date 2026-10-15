import { describe, expect, it } from "vitest";
import { receiptFileSchema, receiptPath, receiptPdfBytes } from "./receipt-file";

describe("receipt file", () => {
  it("gives back every byte, the high ones included", () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
    const file = receiptFileSchema.parse({
      fileName: "recu-KR-2026-000001.pdf",
      pdf: Buffer.from(bytes).toString("base64"),
    });
    expect(receiptPdfBytes(file)).toEqual(bytes);
  });

  it("accepts only a receipt's own file name", () => {
    for (const fileName of ["../recu-KR-2026-000001.pdf", "recu-KR-2026-000001.exe", "facture.pdf", ""]) {
      expect(receiptFileSchema.safeParse({ fileName, pdf: "JVBERi0=" }).success, fileName).toBe(false);
    }
    expect(receiptFileSchema.safeParse({ fileName: "recu-KR-2026-000001.pdf", pdf: "" }).success).toBe(false);
  });

  it("points at the receipt route", () => {
    expect(receiptPath("5f0c3a2e-7b1d-4c9e-8a6f-2d4b1e3c5a70")).toBe(
      "/api/billing/receipts/5f0c3a2e-7b1d-4c9e-8a6f-2d4b1e3c5a70",
    );
  });
});
