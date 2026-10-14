"use client";

import { useTranslations } from "next-intl";
import { ErrorScreen } from "@/components/errors/error-screen";

// Catches a crash in any page under /fr, for example a form posted from a
// page opened before a deploy whose server action no longer exists (KRB-169).
export default function LocaleError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("Errors");

  return (
    <ErrorScreen
      title={t("title")}
      description={t("description")}
      reloadLabel={t("reload")}
      homeLabel={t("home")}
      reference={error.digest ? t("reference", { digest: error.digest }) : undefined}
    />
  );
}
