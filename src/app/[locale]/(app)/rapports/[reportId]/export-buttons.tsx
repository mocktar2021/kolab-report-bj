"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { FileDown, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ExportFormat } from "@/lib/export/types";

const FORMATS: readonly ExportFormat[] = ["docx", "pdf"];

const ERROR_KEYS = ["invalidInput", "forbidden", "notFound", "rateLimited", "tooLarge", "generic"] as const;

type ExportError = (typeof ERROR_KEYS)[number];

/** The route's error key when it sent a known one, else one read from the status. */
function exportError(status: number, body: unknown): ExportError {
  const key = body && typeof body === "object" && "error" in body ? body.error : null;
  const known = ERROR_KEYS.find((error) => error === key);
  if (known) return known;
  if (status === 400 || status === 415) return "invalidInput";
  if (status === 403) return "forbidden";
  if (status === 404) return "notFound";
  if (status === 429) return "rateLimited";
  if (status === 413) return "tooLarge";
  return "generic";
}

/** The download link the route answers with, only if it points to our own export route. */
function downloadUrl(body: unknown): { url: string; fileName: string } | null {
  if (!body || typeof body !== "object" || !("url" in body) || !("fileName" in body)) return null;
  const { url, fileName } = body;
  if (typeof url !== "string" || !url.startsWith("/api/exports/") || typeof fileName !== "string")
    return null;
  return { url, fileName };
}

/** The download route answers with an attachment, so the page stays where it is. */
function startDownload(url: string) {
  window.location.assign(url);
}

type ExportState =
  | { kind: "ready"; fileName: string }
  | { kind: "error"; error: ExportError; format: ExportFormat }
  | null;

type ExportButtonsProps = {
  reportId: string;
  /** Exports one person can make per workspace and hour, for the error message. */
  hourlyLimit: number;
  /** Starts the download. Tests replace it. */
  onDownload?: (url: string) => void;
};

/**
 * "Exporter en .docx" and "Exporter en PDF", for owners and admins. The server
 * builds the file, which can take a few seconds: both buttons wait meanwhile.
 */
export function ExportButtons({ reportId, hourlyLimit, onDownload = startDownload }: ExportButtonsProps) {
  const t = useTranslations("ReportExport");
  const router = useRouter();
  const [pending, setPending] = useState<ExportFormat | null>(null);
  const [state, setState] = useState<ExportState>(null);
  const running = useRef(false);

  async function exportAs(format: ExportFormat) {
    if (running.current) return;
    running.current = true;
    setPending(format);
    setState(null);
    try {
      const response = await fetch(`/api/reports/${reportId}/exports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format }),
      });
      const body: unknown = await response.json().catch(() => null);
      const download = response.status === 201 ? downloadUrl(body) : null;
      if (download) {
        setState({ kind: "ready", fileName: download.fileName });
        // Puts the new file in "Exports récents".
        router.refresh();
        onDownload(download.url);
      } else {
        setState({ kind: "error", error: exportError(response.status, body), format });
      }
    } catch {
      // No answer, for example after a network error.
      setState({ kind: "error", error: "generic", format });
    } finally {
      running.current = false;
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-2 sm:items-end">
      <div className="flex flex-wrap gap-2 sm:justify-end">
        {FORMATS.map((format) => {
          const busy = pending === format;
          return (
            <Button
              key={format}
              type="button"
              variant="outline"
              shape="pill"
              aria-disabled={pending !== null}
              onClick={() => void exportAs(format)}
              className="aria-disabled:cursor-wait aria-disabled:opacity-60"
            >
              {busy ? (
                <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" />
              ) : (
                <FileDown aria-hidden="true" />
              )}
              {t(format)}
            </Button>
          );
        })}
      </div>
      <p role="status" aria-live="polite" className="text-xs sm:text-right">
        {pending ? (
          <span className="text-muted-foreground">{t("pending")}</span>
        ) : state?.kind === "ready" ? (
          <span className="text-muted-foreground">{t("ready", { fileName: state.fileName })}</span>
        ) : state?.kind === "error" ? (
          <span className="text-destructive">
            {t(`errors.${state.error}`, { limit: hourlyLimit, format: state.format })}
          </span>
        ) : null}
      </p>
    </div>
  );
}
