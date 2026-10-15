"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { BellOff } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { PLANS } from "@/lib/billing/catalog";
import { BILLING_TIME_ZONE } from "@/lib/billing/dates";
import type { BillingNotification, NotificationItem } from "@/lib/notifications";
import {
  REPORT_ACTIONS,
  REPORT_TRANSITIONS,
  type ReportAction,
  type ReportStatus,
} from "@/lib/reports/status";
import { cn } from "@/lib/utils";

/** Newer than this, the date is relative ("il y a 3 heures"). Older, it is the day. */
const RELATIVE_MS = 7 * 24 * 60 * 60 * 1000;

/** The action behind a status change, or null for a change the app does not list. */
function actionOf(from: ReportStatus, to: ReportStatus): ReportAction | null {
  return (
    REPORT_ACTIONS.find(
      (action) => REPORT_TRANSITIONS[action].from === from && REPORT_TRANSITIONS[action].to === to,
    ) ?? null
  );
}

type NotificationListProps = {
  notifications: readonly NotificationItem[];
  /** Time of the server render, so relative dates read the same on the server and in the browser. */
  now: string;
};

/**
 * What the user was told about, newest first: status changes, each linking
 * to its report, and renewal reminders, linking to the organization's
 * billing page.
 */
export function NotificationList({ notifications, now }: NotificationListProps) {
  const t = useTranslations("Notifications");
  const format = useFormatter();
  // MarkShownRead marks these as read and refreshes the page. They stay
  // highlighted until the user comes back to the page.
  const [unreadOnOpen] = useState(
    () => new Set(notifications.filter((notification) => !notification.read).map(({ id }) => id)),
  );

  if (notifications.length === 0) {
    return (
      <section className="surface-card mt-8 rounded-2xl border px-6 py-12 text-center shadow-sm">
        <BellOff className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
        <h2 className="mt-3 font-medium">{t("empty.title")}</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t("empty.description")}</p>
      </section>
    );
  }

  const nowDate = new Date(now);

  function billingDate(date: string | null) {
    return date
      ? format.dateTime(new Date(date), {
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: BILLING_TIME_ZONE,
        })
      : "";
  }

  /** A renewal reminder in one sentence, for a pass or for the organization's plan. */
  function billingSentence(notification: BillingNotification) {
    // The organization owner may not belong to the workspace of a pass, so
    // its name can be out of reach.
    const scope = notification.workspaceId
      ? notification.workspaceName
        ? "mission"
        : "missionUnnamed"
      : notification.plan === "trial"
        ? "trial"
        : "subscription";
    const values = {
      scope,
      plan: notification.plan ? PLANS[notification.plan].label : "",
      organization: notification.organizationName ?? t("billing.unknownOrganization"),
      workspace: notification.workspaceName ?? "",
    };
    switch (notification.notice) {
      case "d7":
      case "d1":
        return t("billing.ending", { ...values, date: billingDate(notification.endsAt) });
      case "ended":
        return t("billing.ended", {
          ...values,
          date: billingDate(notification.endsAt),
          graceEnd: billingDate(notification.graceEndsAt),
        });
      case "read_only":
        return t("billing.readOnly", { ...values, date: billingDate(notification.graceEndsAt) });
    }
  }

  return (
    <ul className="surface-card mt-8 divide-y overflow-hidden rounded-2xl border shadow-sm">
      {notifications.map((notification) => {
        const unread = !notification.read || unreadOnOpen.has(notification.id);
        let sentence: string;
        let href: string;
        if (notification.kind === "billing") {
          sentence = billingSentence(notification);
          href = `/organisations/${notification.organizationId}/abonnement`;
        } else {
          const action = actionOf(notification.from, notification.to) ?? "other";
          sentence = notification.actorName
            ? t(`event.${action}`, { actor: notification.actorName, title: notification.reportTitle })
            : t(`eventNoActor.${action}`, { title: notification.reportTitle });
          href = `/rapports/${notification.reportId}`;
        }
        // A clock a little ahead of the database would say "dans 2 secondes".
        const createdAt = new Date(Math.min(new Date(notification.createdAt).getTime(), nowDate.getTime()));
        const when =
          nowDate.getTime() - createdAt.getTime() < RELATIVE_MS
            ? format.relativeTime(createdAt, nowDate)
            : format.dateTime(createdAt, { day: "numeric", month: "long", year: "numeric" });

        return (
          <li key={notification.id}>
            <Link
              href={href}
              className={cn(
                "flex gap-3 px-5 py-4 outline-none transition-colors hover:bg-accent/60 focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                unread && "bg-highlight/[0.04]",
              )}
            >
              <span
                aria-hidden="true"
                className={cn("mt-1.5 size-2 shrink-0 rounded-full", unread ? "bg-highlight" : "bg-border")}
              />
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block break-words text-sm",
                    unread ? "font-medium text-foreground" : "text-muted-foreground",
                  )}
                >
                  {sentence}
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <time
                    dateTime={notification.createdAt}
                    title={format.dateTime(createdAt, { dateStyle: "long", timeStyle: "short" })}
                  >
                    {when}
                  </time>
                  {unread ? (
                    <span className="rounded-full px-2 py-0.5 font-medium text-highlight ring-1 ring-inset ring-highlight/30">
                      {t("unread")}
                    </span>
                  ) : null}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
