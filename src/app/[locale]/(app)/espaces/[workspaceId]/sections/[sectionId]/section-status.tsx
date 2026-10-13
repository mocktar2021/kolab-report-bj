"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { NativeSelect } from "@/components/ui/native-select";
import { SECTION_STATUSES, type SectionStatus } from "@/lib/sections";
import { updateSectionStatus } from "./actions";

/** Status select for the assigned expert and managers. Shows the new value at once. */
export function SectionStatusControl({ sectionId, status }: { sectionId: string; status: SectionStatus }) {
  const t = useTranslations("Deliverables");
  const tStatus = useTranslations("SectionStatus");
  const router = useRouter();
  const [optimistic, setOptimistic] = useOptimistic(status);
  const [failed, setFailed] = useState(false);
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
          setFailed(false);
          startTransition(async () => {
            setOptimistic(next);
            const result = await updateSectionStatus(sectionId, next);
            if (result.ok) router.refresh();
            else setFailed(true);
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
          {t("statusError")}
        </p>
      ) : null}
    </div>
  );
}
