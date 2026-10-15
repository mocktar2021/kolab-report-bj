import { NextResponse } from "next/server";
import { parseReceipt, RECEIPT_COLUMNS, RECEIPT_LINE_COLUMNS, receiptFileName } from "@/lib/billing/receipt";
import { buildReceiptPdf } from "@/lib/billing/receipt-pdf";
import { log, withRequestId } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";
import { uuidSchema } from "@/lib/workspaces/schemas";

// Download of a receipt as a PDF (KRB-177, ADR 001 section 9). The receipt
// and its lines are read with the signed-in user's client, so RLS decides:
// the organization's owner and the owners and admins of its workspaces read
// it, anyone else gets a 404, like a receipt that does not exist. No
// service role here. The PDF is drawn from the stored rows on every
// download and never cached.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

const NO_STORE = { "Cache-Control": "private, no-store" };

function failure(status: 401 | 404 | 500, error: string) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

export const GET = withRequestId(async (_request: Request, { params }: { params: Params }) => {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) return failure(404, "notFound");
  if (!(await getCurrentUser())) return failure(401, "unauthenticated");
  const receiptId = id.toLowerCase();

  const supabase = await createClient();
  const [{ data: row, error }, { data: lines, error: linesError }] = await Promise.all([
    supabase.from("billing_receipts").select(RECEIPT_COLUMNS).eq("id", receiptId).maybeSingle(),
    supabase.from("billing_receipt_lines").select(RECEIPT_LINE_COLUMNS).eq("receipt_id", receiptId),
  ]);
  if (error || linesError) {
    log.error("billing: could not read a receipt", {
      receiptId,
      error: (error ?? linesError)?.message,
    });
    return failure(500, "failed");
  }
  if (!row) return failure(404, "notFound");

  const receipt = parseReceipt(row, lines ?? []);
  if (!receipt) {
    log.error("billing: unexpected receipt rows", { receiptId });
    return failure(500, "failed");
  }

  const pdf = await buildReceiptPdf(receipt);
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      ...NO_STORE,
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${receiptFileName(receipt.number)}"`,
      "Content-Length": String(pdf.length),
      "X-Content-Type-Options": "nosniff",
    },
  });
});
