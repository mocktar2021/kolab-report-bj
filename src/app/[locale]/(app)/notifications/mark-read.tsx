"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import type { NotificationItem } from "@/lib/notifications";
import { markNotificationsRead } from "./actions";

type MarkShownReadProps = {
  notifications: readonly Pick<NotificationItem, "id" | "read">[];
};

/**
 * Marks the unread notifications the page shows as read, once mounted, then
 * refreshes the page so the bell in the header clears. On failure the bell
 * keeps its count and the next visit tries again.
 */
export function MarkShownRead({ notifications }: MarkShownReadProps) {
  const router = useRouter();
  const unreadKey = notifications
    .filter((notification) => !notification.read)
    .map(({ id }) => id)
    .join(",");
  // Effects run twice in development: send each id once.
  const sent = useRef(new Set<string>());

  useEffect(() => {
    const ids = unreadKey.split(",").filter((id) => id !== "" && !sent.current.has(id));
    if (ids.length === 0) return;
    ids.forEach((id) => sent.current.add(id));
    markNotificationsRead(ids)
      .then((result) => {
        if (result.ok) router.refresh();
      })
      .catch(() => {
        // Network error: same as a failed update.
      });
  }, [unreadKey, router]);

  return null;
}

type OlderUnreadProps = {
  /** Unread notifications too old to be in the list. */
  count: number;
};

/** For the unread notifications past the end of the list, which the page cannot mark by itself. */
export function OlderUnread({ count }: OlderUnreadProps) {
  const t = useTranslations("Notifications");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  function markAll() {
    setFailed(false);
    startTransition(async () => {
      const result = await markNotificationsRead().catch(() => ({ ok: false }));
      if (result.ok) {
        router.refresh();
      } else {
        setFailed(true);
      }
    });
  }

  return (
    <div className="mt-4 rounded-2xl border px-5 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">{t("olderUnread", { count })}</p>
        <Button
          type="button"
          variant="outline"
          shape="pill"
          size="sm"
          onClick={markAll}
          disabled={pending}
          className="self-start sm:self-auto"
        >
          {t("markAllRead")}
        </Button>
      </div>
      {failed ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {t("markAllReadError")}
        </p>
      ) : null}
    </div>
  );
}
