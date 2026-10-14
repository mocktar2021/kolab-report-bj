"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Wait after the last change before reloading, so a reorder (one event per row) reloads once. */
export const LIVE_DEBOUNCE_MS = 500;
/** Coming back to the tab reloads at most this often. */
export const VISIBLE_REFRESH_GAP_MS = 5000;

/**
 * Reloads the page data when a section of the report changes in another
 * session (order, assignment, status, text), and when the tab is shown again.
 *
 * report_sections is in the supabase_realtime publication (initial
 * migration), and Realtime applies RLS to each subscriber: people only hear
 * about the sections they can read. Realtime does not run in local dev or CI,
 * so a subscription that never connects is dropped quietly and the page works
 * as before. One that drops after connecting is left to reconnect by itself.
 */
export function useLiveReport(reportId: string) {
  const router = useRouter();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastVisibleRefresh = 0;
    let stopped = false;
    let removeChannel = () => {};

    function onVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastVisibleRefresh < VISIBLE_REFRESH_GAP_MS) return;
      lastVisibleRefresh = now;
      router.refresh();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    // supabase-js only loads after the page is up: no other part of this page needs it.
    void import("@/lib/supabase/client")
      .then(({ createClient }) => {
        if (stopped) return;
        const supabase = createClient();
        let connected = false;
        // A topic of its own: supabase-js hands back a channel with the same topic
        // while it is still leaving, for example when Strict Mode runs the effect twice.
        const topic = `report-sections:${reportId}:${Math.random().toString(36).slice(2)}`;
        const channel = supabase
          .channel(topic)
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "report_sections", filter: `report_id=eq.${reportId}` },
            () => {
              clearTimeout(timer);
              timer = setTimeout(() => router.refresh(), LIVE_DEBOUNCE_MS);
            },
          );
        let removed = false;
        removeChannel = () => {
          if (removed) return;
          removed = true;
          void supabase.removeChannel(channel);
        };

        channel.subscribe((status) => {
          if (status === "SUBSCRIBED") {
            connected = true;
          } else if ((status === "CHANNEL_ERROR" || status === "TIMED_OUT") && !connected && !removed) {
            console.debug("live-report: Realtime is not reachable, the page will not update by itself");
            removed = true;
            // With no channel left, the socket would keep retrying for about a
            // minute before closing: close it now.
            void supabase.removeChannel(channel).then(() => {
              if (supabase.getChannels().length === 0) void supabase.realtime.disconnect();
            });
          }
        });
      })
      .catch(() => {
        // Offline, for example: the page keeps working without live updates.
        console.debug("live-report: could not load the Supabase client");
      });

    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      removeChannel();
    };
  }, [reportId, router]);
}

/** Keeps the master report in step with other sessions. Renders nothing. */
export function LiveReport({ reportId }: { reportId: string }) {
  useLiveReport(reportId);
  return null;
}
