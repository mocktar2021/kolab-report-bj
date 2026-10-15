import { z } from "zod";

// What GET /api/billing/receipts/[id] answers (KRB-189): the file name and
// the PDF in base64, inside JSON. A binary body sent by a Vercel function
// reached the browser changed (ERR_INVALID_RESPONSE), while text arrives as
// sent, so the page turns the base64 back into a file. No server-only import:
// the route and the download button share this module.

/** Where a receipt is read, with the signed-in user's rights. */
export function receiptPath(receiptId: string): string {
  return `/api/billing/receipts/${receiptId}`;
}

export const receiptFileSchema = z.object({
  fileName: z.string().regex(/^recu-[A-Za-z0-9-]+\.pdf$/),
  pdf: z.string().min(1),
});

export type ReceiptFile = z.infer<typeof receiptFileSchema>;

/** The bytes of the PDF, back from base64. */
export function receiptPdfBytes(file: ReceiptFile): Uint8Array<ArrayBuffer> {
  const binary = atob(file.pdf);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
