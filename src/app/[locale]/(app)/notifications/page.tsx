import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AlertCircle } from "lucide-react";
import { countUnreadNotifications, listNotifications } from "@/lib/notifications";
import { MarkShownRead, OlderUnread } from "./mark-read";
import { NotificationList } from "./notification-list";

// Per-user data behind auth: never prerender or cache.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Notifications");
  return { title: t("title") };
}

export default async function NotificationsPage({ params }: { params: Promise<{ locale: "fr" }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Notifications");

  const [notifications, unreadTotal] = await Promise.all([listNotifications(), countUnreadNotifications()]);
  // Past the list limit, unread notifications are not shown, so not marked either.
  const olderUnread = notifications
    ? unreadTotal - notifications.filter((notification) => !notification.read).length
    : 0;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:py-12 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-500">
      <header>
        <h1 className="text-h2 text-foreground">{t("title")}</h1>
        <p className="mt-1 text-small text-muted-foreground">{t("subtitle")}</p>
      </header>

      {notifications === null ? (
        <section className="surface-card mt-8 rounded-2xl border px-6 py-10 text-center shadow-sm">
          <AlertCircle className="mx-auto size-6 text-destructive" aria-hidden="true" />
          <h2 className="mt-3 font-medium">{t("error.title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("error.description")}</p>
        </section>
      ) : (
        <>
          <NotificationList notifications={notifications} now={new Date().toISOString()} />
          {olderUnread > 0 ? <OlderUnread count={olderUnread} /> : null}
          <MarkShownRead notifications={notifications} />
        </>
      )}
    </div>
  );
}
