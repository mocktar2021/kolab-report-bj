import { CalendarClock } from "lucide-react";
import { useTranslations } from "next-intl";
import { PUBLISHER } from "@/content/legal/publisher";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Countdown } from "./countdown";
import { LaunchReminderForm } from "./reminder-form";

/**
 * Launch date, countdown and reminder form, shown before sign-up opens
 * (KRB-239). A Server Component: it translates the text and hands it to the
 * two Client Components, so the Launch messages stay out of every page's
 * client scope (src/i18n/client-messages.ts).
 */
export function LaunchPanel({ until, className }: { until: string; className?: string }) {
  const t = useTranslations("Launch");

  return (
    <div className={cn("mx-auto w-full max-w-md text-center", className)}>
      <p className="inline-flex items-center gap-2 rounded-full bg-highlight/10 px-3 py-1 text-sm font-medium text-highlight ring-1 ring-inset ring-highlight/25 dark:bg-highlight/15">
        <CalendarClock aria-hidden="true" className="size-4 shrink-0" />
        {t("badge")}
      </p>
      <Countdown
        until={until}
        label={t("countdownLabel")}
        units={{
          days: t("units.days"),
          hours: t("units.hours"),
          minutes: t("units.minutes"),
          seconds: t("units.seconds"),
        }}
        className="mt-5"
      />
      <LaunchReminderForm
        text={{
          emailLabel: t("emailLabel"),
          submit: t("submit"),
          honeypot: t("honeypot"),
          done: t("done"),
          errors: {
            emailInvalid: t("errors.emailInvalid"),
            unavailable: t("errors.unavailable", { email: PUBLISHER.email }),
          },
          privacy: t.rich("privacy", {
            link: (chunks) => (
              <Link href="/confidentialite" prefetch={false} className="underline underline-offset-4">
                {chunks}
              </Link>
            ),
          }),
        }}
        className="mt-6"
      />
    </div>
  );
}
