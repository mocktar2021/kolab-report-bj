"use client";

import { Component, useEffect, useState, type ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { loadPreview, type DeliverablePreview as Preview } from "./actions";

/**
 * Props for the DOM element: our classes plus the element's own, without the
 * `node` prop react-markdown adds, which would show up as an attribute.
 */
function domProps<P extends { node?: unknown; className?: string }>(props: P, classes: string) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { node, className, ...rest } = props;
  return { ...rest, className: cn(classes, className) };
}

// Markdown becomes React elements: raw HTML in a file is shown as text and
// never inserted into the page, and react-markdown drops javascript: links.
const COMPONENTS: Components = {
  h1: (props) => <h3 {...domProps(props, "mt-4 text-base font-semibold first:mt-0")} />,
  h2: (props) => <h4 {...domProps(props, "mt-4 text-sm font-semibold first:mt-0")} />,
  h3: (props) => <h5 {...domProps(props, "mt-3 text-sm font-semibold first:mt-0")} />,
  h4: (props) => <h6 {...domProps(props, "mt-3 text-sm font-medium first:mt-0")} />,
  h5: (props) => <h6 {...domProps(props, "mt-3 text-sm font-medium first:mt-0")} />,
  h6: (props) => <h6 {...domProps(props, "mt-3 text-sm font-medium first:mt-0")} />,
  p: (props) => <p {...domProps(props, "mt-2 first:mt-0")} />,
  ul: (props) => <ul {...domProps(props, "mt-2 list-disc space-y-1 pl-5")} />,
  ol: (props) => <ol {...domProps(props, "mt-2 list-decimal space-y-1 pl-5")} />,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="underline underline-offset-2"
    >
      {children}
    </a>
  ),
  table: (props) => (
    <div className="mt-3 overflow-x-auto rounded-lg border">
      <table {...domProps(props, "w-full border-collapse text-left text-xs")} />
    </div>
  ),
  th: (props) => <th {...domProps(props, "border-b bg-muted/60 px-2.5 py-1.5 font-medium")} />,
  td: (props) => <td {...domProps(props, "border-b px-2.5 py-1.5 align-top")} />,
  img: () => null,
};

/** Shows `fallback` if react-markdown throws on a file, instead of taking the page down. */
class MarkdownBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

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
        ) : meta?.kind === "text" ? (
          // A .txt or .md file is shown as written: a crafted .md can freeze or crash react-markdown.
          <pre className="whitespace-pre-wrap break-words font-sans">{markdown}</pre>
        ) : (
          <MarkdownBoundary fallback={<p className="text-destructive">{t("previewError")}</p>}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
              {markdown}
            </ReactMarkdown>
          </MarkdownBoundary>
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
          {meta?.truncated ? <li>{t("previewTruncated")}</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
