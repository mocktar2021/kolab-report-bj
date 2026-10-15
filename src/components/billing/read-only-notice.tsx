import { useTranslations } from "next-intl";
import { Lock } from "lucide-react";
import type { ReadOnlyReason } from "@/lib/billing/banner";
import { formatBillingDate } from "@/lib/billing/dates";
import { cn } from "@/lib/utils";

/** Id of the notice, for the disabled buttons that point to it with aria-describedby. */
export const READ_ONLY_NOTICE_ID = "lecture-seule";

/**
 * Says a workspace is read-only because its plan ended (KRB-178), on the
 * pages whose edits it turns off: since when, and who can renew. Reading and
 * exporting still work.
 */
export function ReadOnlyNotice({ reason, className }: { reason: ReadOnlyReason; className?: string }) {
  const t = useTranslations("Workspaces.errors");
  const text = reason.since
    ? t(reason.canManage ? "readOnly" : "readOnlyMember", { date: formatBillingDate(reason.since) })
    : t(reason.canManage ? "readOnlyNoPlan" : "readOnlyNoPlanMember");

  return (
    <p
      id={READ_ONLY_NOTICE_ID}
      className={cn(
        "flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/[0.06] px-4 py-3 text-sm text-foreground",
        className,
      )}
    >
      <Lock className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
      <span>{text}</span>
    </p>
  );
}
