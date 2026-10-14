"use client";

import { useTranslations } from "next-intl";
import { Bell } from "lucide-react";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const NOTIFICATIONS_PATH = "/notifications";

/** Past this count, the badge shows "9+". */
const BADGE_MAX = 9;

type NotificationBellProps = {
  /** Unread notifications, counted on the server by the (app) layout. */
  unread: number;
  className?: string;
};

/** Link to the notifications page, with the unread count as a badge (KRB-124). */
export function NotificationBell({ unread, className }: NotificationBellProps) {
  const t = useTranslations("Notifications");
  const pathname = usePathname();
  const active = pathname === NOTIFICATIONS_PATH;

  return (
    <Link
      href={NOTIFICATIONS_PATH}
      aria-label={t("bell", { count: unread })}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex size-9 shrink-0 items-center justify-center rounded-lg outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        active ? "bg-accent text-foreground" : "text-muted-foreground",
        className,
      )}
    >
      <Bell className="size-5" aria-hidden="true" />
      {unread > 0 ? (
        <span
          aria-hidden="true"
          className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-highlight px-1 text-[10px] font-semibold leading-none tabular-nums text-highlight-foreground ring-2 ring-background"
        >
          {unread > BADGE_MAX ? `${BADGE_MAX}+` : unread}
        </span>
      ) : null}
    </Link>
  );
}
