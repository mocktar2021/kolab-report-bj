"use client";

import { useEffect, useRef } from "react";

/** Wait after the last change before calling onChange, so a reorder (one event per row) calls it once. */
export const LIVE_DEBOUNCE_MS = 500;
/** Coming back to the tab calls onChange at most this often. */
export const VISIBLE_REFRESH_GAP_MS = 5000;

export type LiveSectionsOptions = {
  /** Start of the channel topic, for example `report-sections:<reportId>`. Each mount adds its own suffix. */
  topic: string;
  /** postgres_changes filter on report_sections, for example `report_id=eq.<reportId>`. */
  filter: string;
  /** Reloads the data. Called after a burst of changes, when the tab is shown again and after a reconnect. */
  onChange: () => void;
};

/**
 * Calls onChange when a section matching the filter changes in another
 * session, when the tab is shown again, and when Realtime reconnects after a
 * drop, since changes made while it was down are never sent.
 *
 * report_sections is in the supabase_realtime publication (initial
 * migration), and Realtime applies RLS to each subscriber. Where Realtime is
 * not running, a local stack started without it for example, a subscription
 * that never connects is dropped quietly and the page works as before.
 * Realtime does not pass on deletes when a filter is set: a deleted section
 * shows at the next refresh.
 */
export function useLiveSections({ topic, filter, onChange }: LiveSectionsOptions) {
  // A new onChange on each render must not open a new channel.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

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
      onChangeRef.current();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    // The Realtime client only loads after the page is up: no other part of
    // the page needs it.
    void import("./client")
      .then(async ({ createRealtimeClient }) => {
        if (stopped) return;
        const realtime = createRealtimeClient();
        // A channel that joins before the client has the user's token goes in
        // with the anon key, and Realtime refuses the subscription since anon
        // cannot read report_sections. So the token comes first.
        await realtime.setAuth();
        if (stopped) return;

        let connected = false;
        let dropped = false;
        let removed = false;

        function giveUp(reason: string) {
          console.debug(`live-sections: ${reason}, the page will not update by itself`);
          removed = true;
          // With no channel left, the socket would keep retrying for about a
          // minute before closing: close it now.
          void realtime.removeChannel(channel).then(() => {
            if (realtime.getChannels().length === 0) void realtime.disconnect();
          });
        }

        // A topic of its own: realtime-js hands back a channel with the same topic
        // while it is still leaving, for example when Strict Mode runs the effect twice.
        const channel = realtime
          .channel(`${topic}:${Math.random().toString(36).slice(2)}`)
          .on("postgres_changes", { event: "*", schema: "public", table: "report_sections", filter }, () => {
            clearTimeout(timer);
            timer = setTimeout(() => onChangeRef.current(), LIVE_DEBOUNCE_MS);
          })
          // The join itself succeeds even when Realtime then refuses the changes
          // (no table access, bad filter): it says so in a system message.
          .on("system", {}, (payload: { extension?: string; status?: string }) => {
            if (!removed && payload.extension === "postgres_changes" && payload.status === "error") {
              giveUp("Realtime refused the subscription");
            }
          });
        removeChannel = () => {
          if (removed) return;
          removed = true;
          void realtime.removeChannel(channel);
        };

        // What realtime-js 2.117 does: when the socket drops, a joined channel
        // reports CHANNEL_ERROR. When the socket is back, the channel rejoins with
        // the same join push, whose hooks are kept, so this callback gets
        // SUBSCRIBED again. A rejoin that gets no answer reports TIMED_OUT and is
        // retried. CLOSED means the channel left and does not rejoin by itself.
        channel.subscribe((status) => {
          if (removed) return;
          if (status === "SUBSCRIBED") {
            if (dropped) {
              // Back after a drop: reload now, a pending debounced reload is part of it.
              dropped = false;
              clearTimeout(timer);
              onChangeRef.current();
            }
            connected = true;
          } else if (connected) {
            if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") dropped = true;
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            giveUp("Realtime is not reachable");
          }
        });
      })
      .catch(() => {
        // Offline, for example: the page keeps working without live updates.
        console.debug("live-sections: could not start Realtime");
      });

    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      removeChannel();
    };
  }, [topic, filter]);
}
