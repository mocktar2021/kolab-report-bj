"use client";

import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { LoaderCircle } from "lucide-react";
import { Markdown } from "@/components/markdown";
import { loadPreview, type DeliverablePreview as Preview } from "./actions";

/** What the app read from a file, or the image itself. */
export function DeliverablePreview({ id, name, isImage }: { id: string; name: string; isImage: boolean }) {
  const t = useTranslations("Deliverables");
  const format = useFormatter();
  const [preview, setPreview] = useState<Preview | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (isImage) return;
    let active = true;
    loadPreview(id)
      .then((result) => {
        if (active) setPreview(result);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [id, isImage]);

  if (isImage) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL, not a static asset
      <img
        src={`/api/deliverables/${id}/file?apercu`}
        alt={t("imageAlt", { name })}
        className="max-h-96 rounded-lg border bg-muted/30 object-contain"
      />
    );
  }

  if (failed || preview === null) {
    return <p className="text-sm text-destructive">{t("previewError")}</p>;
  }
  if (preview === undefined) {
    return (
      <p className="inline-flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" />
        {t("previewLoading")}
      </p>
    );
  }

  const { markdown, meta } = preview;
  const cappedSheets = (meta?.sheets ?? []).filter(
    (sheet) => sheet.keptRows < sheet.rows || sheet.keptColumns < sheet.columns,
  );
  // A PDF whose reading stopped before its last page, at the page or character limit.
  const pdfPages =
    meta?.pages !== undefined && meta.pagesRead !== undefined && meta.pagesRead < meta.pages
      ? { read: meta.pagesRead, pages: meta.pages }
      : null;

  return (
    <div className="rounded-xl border bg-muted/20">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-4 py-2.5">
        <p className="text-xs font-medium">{t("previewTitle")}</p>
        {meta ? (
          <p className="text-xs text-muted-foreground">
            {t("previewStats", { words: meta.words, tokens: meta.tokenEstimate })}
          </p>
        ) : null}
      </div>
      <div className="max-h-[32rem] overflow-y-auto px-4 py-3 text-sm leading-relaxed">
        {!markdown ? (
          <p className="text-muted-foreground">{t("previewEmpty")}</p>
        ) : meta?.kind === "text" || meta?.kind === "pdf" ? (
          // A .txt or .md file is shown as written: a crafted .md can freeze or crash react-markdown.
          // The text of a PDF is plain text too, never Markdown.
          <pre className="whitespace-pre-wrap break-words font-sans">{markdown}</pre>
        ) : (
          <Markdown fallback={<p className="text-destructive">{t("previewError")}</p>}>{markdown}</Markdown>
        )}
      </div>
      {cappedSheets.length > 0 || meta?.truncated ? (
        <ul className="space-y-0.5 border-t px-4 py-2.5 text-xs text-muted-foreground">
          {cappedSheets.map((sheet) => (
            <li key={sheet.name}>
              {t("previewSheet", {
                name: sheet.name,
                keptRows: format.number(sheet.keptRows),
                rows: format.number(sheet.rows),
                keptColumns: format.number(sheet.keptColumns),
                columns: format.number(sheet.columns),
              })}
            </li>
          ))}
          {pdfPages ? (
            <li>
              {t("previewPages", {
                read: format.number(pdfPages.read),
                pages: format.number(pdfPages.pages),
              })}
            </li>
          ) : meta?.truncated ? (
            <li>{t("previewTruncated")}</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
