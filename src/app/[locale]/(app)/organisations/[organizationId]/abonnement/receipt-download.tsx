"use client";

import { useState } from "react";
import { receiptFileSchema, receiptPath, receiptPdfBytes } from "@/lib/billing/receipt-file";

/** The blob URL outlives the click by a minute, so the browser has saved the file before it goes. */
const REVOKE_AFTER_MS = 60_000;

/**
 * Downloads a receipt (KRB-189): reads it from the route as JSON, turns the
 * base64 back into the PDF and saves it under the receipt's file name. The
 * texts come from the server component, so this needs no client messages.
 */
export function ReceiptDownload({
  receiptId,
  label,
  failedText,
  className,
  children,
}: {
  receiptId: string;
  /** Accessible name, for example "Télécharger le reçu KR-2026-000001 en PDF". */
  label: string;
  failedText: string;
  className: string;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");

  async function download() {
    if (state === "busy") return;
    setState("busy");
    try {
      const response = await fetch(receiptPath(receiptId), { cache: "no-store" });
      if (!response.ok) throw new Error(`receipt answered ${response.status}`);
      const file = receiptFileSchema.parse(await response.json());
      const url = URL.createObjectURL(new Blob([receiptPdfBytes(file)], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = file.fileName;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
      setState("idle");
    } catch {
      setState("failed");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={download}
        aria-label={label}
        aria-busy={state === "busy"}
        className={className}
      >
        {children}
      </button>
      {state === "failed" ? (
        <span role="alert" className="mt-1 block whitespace-normal text-xs text-destructive">
          {failedText}
        </span>
      ) : null}
    </>
  );
}
