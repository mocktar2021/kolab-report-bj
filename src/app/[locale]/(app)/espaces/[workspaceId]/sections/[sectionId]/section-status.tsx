"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { NativeSelect } from "@/components/ui/native-select";
import { SECTION_STATUSES, type SectionStatus } from "@/lib/sections";
import { updateSectionStatus } from "./actions";

/** Status select for the assigned expert and managers. Shows the new value at once. */
export function SectionStatusControl({ sectionId, status }: { sectionId: string; status: SectionStatus }) {
  const t = useTranslations("Deliverables");
  const tStatus = useTranslations("SectionStatus");
  const [optimistic, setOptimistic] = useOptimistic(status);
  const [failed, setFailed] = useState<"generic" | "reportFinal" | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="section-status" className="text-sm text-muted-foreground">
        {t("statusLabel")}
      </label>
      <NativeSelect
        id="section-status"
        value={optimistic}
        disabled={pending}
        className="w-44"
        selectClassName="h-9"
        aria-describedby={failed ? "section-status-error" : undefined}
        onChange={(event) => {
          const next = event.target.value as SectionStatus;
          setFailed(null);
          startTransition(async () => {
            setOptimistic(next);
            // On success the action sends the page back with the new status, in
            // this same transition, so the select never shows the old value.
            try {
              const result = await updateSectionStatus(sectionId, next);
              if (!result.ok) setFailed(result.error ?? "generic");
            } catch {
              setFailed("generic");
            }
          });
        }}
      >
        {SECTION_STATUSES.map((value) => (
          <option key={value} value={value}>
            {tStatus(value)}
          </option>
        ))}
      </NativeSelect>
      {failed ? (
        <p id="section-status-error" role="alert" className="text-xs text-destructive">
          {failed === "reportFinal" ? t("statusReportFinal") : t("statusError")}
        </p>
      ) : null}
    </div>
  );
}
