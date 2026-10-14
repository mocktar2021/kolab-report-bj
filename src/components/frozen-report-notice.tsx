import { useTranslations } from "next-intl";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

/** Says a final report is read-only for everyone, on the report page and its section pages. */
export function FrozenReportNotice({ className }: { className?: string }) {
  const t = useTranslations("ReportStatus");

  return (
    <p
      className={cn(
        "flex items-start gap-2.5 rounded-xl border border-foreground/15 bg-muted/40 px-4 py-3 text-sm text-foreground",
        className,
      )}
    >
      <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{t("frozen")}</span>
    </p>
  );
}
