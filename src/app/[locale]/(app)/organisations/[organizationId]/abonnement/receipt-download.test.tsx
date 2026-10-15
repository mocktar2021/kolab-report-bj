import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReceiptDownload } from "./receipt-download";

const RECEIPT_ID = "5f0c3a2e-7b1d-4c9e-8a6f-2d4b1e3c5a70";
const LABEL = "Télécharger le reçu KR-2026-000001 en PDF";
const FAILED = "Le reçu n'a pas pu être téléchargé. Réessayez dans un instant.";
const PDF = "%PDF-1.3 test";

let blobs: Blob[];
let saved: { href: string; download: string }[];
const revokeObjectURL = vi.fn();

function answer(ok: boolean, body: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 404, json: async () => body }));
}

function renderButton() {
  render(
    <ReceiptDownload receiptId={RECEIPT_ID} label={LABEL} failedText={FAILED} className="">
      Télécharger
    </ReceiptDownload>,
  );
  return screen.getByRole("button", { name: LABEL });
}

beforeEach(() => {
  blobs = [];
  saved = [];
  Object.assign(URL, {
    createObjectURL: vi.fn((blob: Blob) => {
      blobs.push(blob);
      return "blob:http://localhost:3000/receipt";
    }),
    revokeObjectURL,
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    saved.push({ href: this.href, download: this.download });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  revokeObjectURL.mockReset();
});

describe("ReceiptDownload", () => {
  it("reads the receipt and saves the PDF under its own name", async () => {
    answer(true, { fileName: "recu-KR-2026-000001.pdf", pdf: Buffer.from(PDF).toString("base64") });
    await userEvent.setup().click(renderButton());

    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(fetch).toHaveBeenCalledWith(`/api/billing/receipts/${RECEIPT_ID}`, { cache: "no-store" });
    expect(saved[0]).toEqual({
      href: "blob:http://localhost:3000/receipt",
      download: "recu-KR-2026-000001.pdf",
    });
    expect(blobs[0]?.type).toBe("application/pdf");
    expect(blobs[0]?.size).toBe(PDF.length);
    // Released later, not before the browser has saved the file.
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says so when the route refuses, and saves nothing", async () => {
    answer(false, { error: "notFound" });
    await userEvent.setup().click(renderButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(FAILED);
    expect(saved).toHaveLength(0);
  });

  it("says so when the answer is not a receipt file", async () => {
    answer(true, { fileName: "facture.exe", pdf: "JVBERi0=" });
    await userEvent.setup().click(renderButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(FAILED);
    expect(saved).toHaveLength(0);
  });
});
