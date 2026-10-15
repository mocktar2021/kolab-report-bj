"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

const EVERY_MS = 5_000;
const FOR_MS = 120_000;

/**
 * While a payment is pending, the page renders again every 5 seconds for 2
 * minutes (ADR 001, 8.3). Each render checks FedaPay at most every 10
 * seconds. After that, it says to come back later.
 */
export function PendingRefresh() {
  const t = useTranslations("Billing.return");
  const router = useRouter();
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - started >= FOR_MS) {
        window.clearInterval(timer);
        setGaveUp(true);
        return;
      }
      router.refresh();
    }, EVERY_MS);
    return () => window.clearInterval(timer);
  }, [router]);

  return gaveUp ? <p className="mt-3 text-sm text-muted-foreground">{t("stillPending")}</p> : null;
}
