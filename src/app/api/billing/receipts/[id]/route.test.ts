// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { receiptFileSchema, receiptPdfBytes } from "@/lib/billing/receipt-file";
import { buildReceiptPdf } from "@/lib/billing/receipt-pdf";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";
import { GET } from "./route";

vi.mock("@/lib/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  withRequestId: (handler: (...args: unknown[]) => Promise<Response>) => handler,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/billing/receipt-pdf", () => ({ buildReceiptPdf: vi.fn() }));

const RECEIPT_ID = "5f0c3a2e-7b1d-4c9e-8a6f-2d4b1e3c5a70";

const ROW = {
  id: RECEIPT_ID,
  number: "KR-2026-000042",
  kind: "receipt",
  environment: "live",
  issued_at: "2026-10-15T09:30:00+00:00",
  seller: { name: "Mocktar Technologies", ifu: "1200900488800" },
  buyer: { name: "Cabinet A", legal_name: "Cabinet A SARL" },
  payment: { method: "fedapay", mode: "mtn_open", paid_at: "2026-10-15T09:29:00+00:00" },
  total_ht_xof: 15000,
  total_tax_xof: 0,
  total_xof: 15000,
  external_invoice_number: null,
};

const LINE = {
  position: 1,
  label: "Indépendant, 1 mois",
  period_start: "2026-10-15",
  period_end: "2026-11-15",
  quantity: 1,
  unit_price_ht_xof: 15000,
  amount_ht_xof: 15000,
  tax_code: null,
  tax_rate: null,
  tax_xof: 0,
};

/** What RLS lets the signed-in user read: the receipt row and its lines. */
function readable(row: unknown, lines: unknown[] = [LINE]) {
  const from = vi.fn((table: string) => {
    const query = {
      select: () => query,
      eq: vi.fn(() => query),
      maybeSingle: () => Promise.resolve({ data: row, error: null }),
      then: (resolve: (value: unknown) => unknown) => resolve({ data: lines, error: null }),
    };
    void table;
    return query;
  });
  vi.mocked(createClient).mockResolvedValue({ from } as unknown as Awaited<ReturnType<typeof createClient>>);
  return from;
}

function get(id: string) {
  return GET(new Request(`http://localhost:3000/api/billing/receipts/${id}`), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  vi.mocked(getCurrentUser).mockResolvedValue({ id: "u1" } as Awaited<ReturnType<typeof getCurrentUser>>);
  vi.mocked(buildReceiptPdf).mockResolvedValue(Buffer.from("%PDF-1.3 test"));
});

describe("GET /api/billing/receipts/[id]", () => {
  it("sends the PDF in base64 with the receipt's file name, never cached", async () => {
    const from = readable(ROW);
    const response = await get(RECEIPT_ID.toUpperCase());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const file = receiptFileSchema.parse(await response.json());
    expect(file.fileName).toBe("recu-KR-2026-000042.pdf");
    expect(Buffer.from(receiptPdfBytes(file)).toString("latin1")).toBe("%PDF-1.3 test");
    // Read with the user's client, by the lowercase id, never with the service role.
    expect(from).toHaveBeenCalledWith("billing_receipts");
    expect(from).toHaveBeenCalledWith("billing_receipt_lines");
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(vi.mocked(buildReceiptPdf).mock.calls[0]?.[0]).toMatchObject({
      number: "KR-2026-000042",
      buyer: { legalName: "Cabinet A SARL" },
      lines: [{ label: "Indépendant, 1 mois" }],
    });
  });

  it("answers 404 when RLS hides the receipt: another organization, an expert, a viewer", async () => {
    readable(null, []);
    const response = await get(RECEIPT_ID);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(buildReceiptPdf).not.toHaveBeenCalled();
  });

  it("answers 404 for an id that is not a uuid and 401 without a session", async () => {
    readable(ROW);
    expect((await get("KR-2026-000042")).status).toBe(404);
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await get(RECEIPT_ID)).status).toBe(401);
    expect(buildReceiptPdf).not.toHaveBeenCalled();
  });

  it("answers 500 when the stored rows do not make a receipt", async () => {
    readable(ROW, []);
    expect((await get(RECEIPT_ID)).status).toBe(500);
  });

  it("answers 500, never cached, when the PDF cannot be drawn", async () => {
    readable(ROW);
    vi.mocked(buildReceiptPdf).mockRejectedValue(new Error("Cannot find module 'Helvetica.cjs'"));
    const response = await get(RECEIPT_ID);
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ error: "failed" });
  });
});
